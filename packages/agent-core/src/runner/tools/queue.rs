//! Ordered, retained tool execution under the shared/exclusive gate.
use super::*;
use futures_util::{StreamExt, stream::FuturesUnordered};
use std::{
    collections::VecDeque,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    task::{Context, Poll},
};

pub(in crate::runner) struct CompletedTool {
    pub(super) prepared: PreparedTool,
    pub(super) result: Result<tool_feedback::Execution, RunError>,
    permit: GatePermit,
}
pub(in crate::runner) enum QueueStep {
    Event(Option<ModelStreamEvent>),
    Tool(Box<CompletedTool>),
}
#[derive(Clone, Copy)]
enum GatePermit {
    None,
    Shared,
    Exclusive,
}
type ToolFuture<'a> = Pin<Box<dyn Future<Output = (usize, CompletedTool)> + Send + 'a>>;

pub(in crate::runner) struct ToolQueue<'a> {
    tools: &'a dyn ToolExecutor,
    waiting: VecDeque<(usize, PreparedTool)>,
    active: FuturesUnordered<ToolFuture<'a>>,
    exclusive: bool,
    readers: usize,
    next_result: usize,
    awaiting_receipt: Option<GatePermit>,
    results: Vec<Option<CompletedTool>>,
    dispatch_stopped: Arc<AtomicBool>,
}
impl<'a> ToolQueue<'a> {
    pub(in crate::runner) fn new(tools: &'a dyn ToolExecutor) -> Self {
        Self {
            tools,
            waiting: VecDeque::new(),
            active: FuturesUnordered::new(),
            exclusive: false,
            readers: 0,
            next_result: 0,
            awaiting_receipt: None,
            results: vec![],
            dispatch_stopped: Arc::new(AtomicBool::new(false)),
        }
    }
    pub(in crate::runner) fn admit(&mut self, prepared: PreparedTool) {
        let index = self.results.len();
        self.results.push(None);
        self.waiting.push_back((index, prepared));
    }
    pub(in crate::runner) fn stop_waiting(&mut self) {
        // A failed durable boundary cannot authorize another effect. Already
        // running owners still require teardown; unstarted intents need recovery.
        self.dispatch_stopped.store(true, Ordering::Release);
        self.waiting.clear();
    }
    pub(in crate::runner) fn abort_waiting(&mut self) {
        self.dispatch_stopped.store(true, Ordering::Release);
        for (index, prepared) in self.waiting.drain(..) {
            let output = prepared.feedback.as_ref().map_or_else(
                tool_feedback::stopped_before_start,
                |feedback| ToolOutput {
                    content: feedback.content.clone(),
                    is_error: feedback.is_error,
                },
            );
            self.results[index] = Some(CompletedTool {
                prepared,
                permit: GatePermit::None,
                result: Ok(tool_feedback::Execution {
                    output,
                    receipt_required: false,
                    canceled: false,
                }),
            });
        }
    }
    fn dispatch(&mut self) {
        if self.dispatch_stopped.load(Ordering::Acquire) {
            return;
        }
        while let Some((_, next)) = self.waiting.front() {
            // FIFO shared/exclusive admission: reads cannot pass a queued writer.
            if self.exclusive || (!next.parallel && self.readers != 0) {
                break;
            }
            let (index, prepared) = self.waiting.pop_front().expect("inspected tool");
            self.exclusive = !prepared.parallel;
            if prepared.parallel {
                self.readers += 1;
            }
            let permit = if prepared.parallel {
                GatePermit::Shared
            } else {
                GatePermit::Exclusive
            };
            let tools = self.tools;
            let dispatch_stopped = self.dispatch_stopped.clone();
            self.active.push(Box::pin(async move {
                let result = if let Some(output) = &prepared.feedback {
                    Ok(tool_feedback::Execution {
                        output: ToolOutput {
                            content: output.content.clone(),
                            is_error: output.is_error,
                        },
                        receipt_required: false,
                        canceled: false,
                    })
                } else if dispatch_stopped.load(Ordering::Acquire) {
                    Ok(tool_feedback::Execution {
                        output: tool_feedback::stopped_before_start(),
                        receipt_required: false,
                        canceled: false,
                    })
                } else {
                    tool_feedback::execute(tools, prepared.call.clone().expect("validated call"))
                        .await
                };
                (
                    index,
                    CompletedTool {
                        prepared,
                        result,
                        permit,
                    },
                )
            }));
        }
    }
    fn poll(&mut self, cx: &mut Context<'_>) {
        // Observe owners already eligible to finish before admitting any new
        // work. A fatal result or cancellation closes the effect boundary.
        while let Poll::Ready(Some((index, completed))) = self.active.poll_next_unpin(cx) {
            self.results[index] = Some(completed);
            if self.stopped() {
                self.dispatch_stopped.store(true, Ordering::Release);
                return;
            }
        }
        if self.stopped() {
            self.dispatch_stopped.store(true, Ordering::Release);
            return;
        }
        self.dispatch();
        while let Poll::Ready(Some((index, completed))) = self.active.poll_next_unpin(cx) {
            self.results[index] = Some(completed);
            if self.stopped() {
                self.dispatch_stopped.store(true, Ordering::Release);
                return;
            }
        }
    }
    fn stopped(&self) -> bool {
        self.results.iter().flatten().any(|completed| {
            completed.prepared.failure.is_some()
                || match &completed.result {
                    Err(_) => true,
                    Ok(execution) => execution.canceled,
                }
        })
    }
    pub(in crate::runner) async fn next(
        &mut self,
        next: &mut ModelFuture<'_, Option<ModelStreamEvent>>,
    ) -> Result<QueueStep, RunError> {
        // Preserve one pending transport read while tools wake and progress.
        std::future::poll_fn(|cx| {
            self.poll(cx);
            if let Some(error) = self
                .results
                .iter()
                .flatten()
                .filter_map(|completed| {
                    completed
                        .result
                        .as_ref()
                        .err()
                        .or(completed.prepared.failure.as_ref())
                })
                .reduce(|first, next| {
                    if failure_priority(next) > failure_priority(first) {
                        next
                    } else {
                        first
                    }
                })
                .cloned()
            {
                return Poll::Ready(Err(error));
            }
            // A later parallel owner may finish cancellation while an earlier
            // owner is still draining. Close the model stream immediately so
            // that owner can finish; results remain queued for ordered commit.
            if self.results.iter().flatten().any(|completed| {
                completed
                    .result
                    .as_ref()
                    .is_ok_and(|execution| execution.canceled)
            }) {
                return Poll::Ready(Err(ModelError::Canceled.into()));
            }
            if let Some(result) = self
                .results
                .get_mut(self.next_result)
                .and_then(Option::take)
            {
                self.next_result += 1;
                self.awaiting_receipt = Some(result.permit);
                return Poll::Ready(Ok(QueueStep::Tool(Box::new(result))));
            }
            next.as_mut()
                .poll(cx)
                .map(|result| result.map(QueueStep::Event).map_err(RunError::from))
        })
        .await
    }
    pub(in crate::runner) async fn next_result(&mut self) -> Option<CompletedTool> {
        assert!(
            self.awaiting_receipt.is_none(),
            "release the preceding result gate"
        );
        std::future::poll_fn(|cx| {
            self.poll(cx);
            if let Some(result) = self
                .results
                .get_mut(self.next_result)
                .and_then(Option::take)
            {
                self.next_result += 1;
                self.awaiting_receipt = Some(result.permit);
                return Poll::Ready(Some(result));
            }
            if self.waiting.is_empty() && self.active.is_empty() {
                Poll::Ready(None)
            } else {
                Poll::Pending
            }
        })
        .await
    }
    pub(in crate::runner) fn release_result(&mut self) {
        // A conflicting successor cannot begin until durable result+receipt,
        // including the context observer used by dependent budget tools.
        match self
            .awaiting_receipt
            .take()
            .expect("one issued tool result")
        {
            GatePermit::Shared => self.readers -= 1,
            GatePermit::Exclusive => self.exclusive = false,
            GatePermit::None => {}
        }
    }
}

#[cfg(test)]
#[path = "queue_tests.rs"]
mod tests;
