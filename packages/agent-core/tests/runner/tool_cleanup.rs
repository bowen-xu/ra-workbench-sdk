use super::*;
use std::sync::atomic::AtomicBool;
use tokio::sync::Notify;

#[tokio::test]
async fn oversized_result_write_failure_keeps_owner_and_blocks_waiting_tool() {
    struct LargeTools {
        release: Arc<Notify>,
        starts: Mutex<Vec<String>>,
        receipts: AtomicUsize,
    }
    impl ToolExecutor for LargeTools {
        fn validate(&self, _: &ToolCall) -> Result<(), RunError> {
            Ok(())
        }
        fn authorize_and_execute(&self, call: ToolCall) -> RunFuture<'_, ToolOutput> {
            self.starts.lock().unwrap().push(call.call_id);
            let release = self.release.clone();
            Box::pin(async move {
                release.notified().await;
                Ok(ToolOutput {
                    content: "🦀".repeat(70_000),
                    is_error: false,
                })
            })
        }
        fn result_committed(&self, _: ToolCall) -> RunFuture<'_, ()> {
            self.receipts.fetch_add(1, Ordering::SeqCst);
            Box::pin(async { Ok(()) })
        }
    }
    struct FailLarge<'a> {
        sink: &'a Sink,
        release: Arc<Notify>,
        chunks: AtomicUsize,
    }
    impl TurnEventSink for FailLarge<'_> {
        fn emit(&self, payload: EventPayload) -> RunFuture<'_, ()> {
            Box::pin(async move {
                if matches!(&payload, EventPayload::TextDelta { text, .. } if text.starts_with('🦀'))
                    && self.chunks.fetch_add(1, Ordering::SeqCst) == 1
                {
                    return Err(RunError::EventSink);
                }
                let finished = matches!(payload, EventPayload::ModelRequestFinished { .. });
                self.sink.emit(payload).await?;
                if finished {
                    self.release.notify_one();
                }
                Ok(())
            })
        }
    }
    let mut events = vec![begin()];
    events.extend(call("running", "{}"));
    events.extend(call("waiting", "{}"));
    events.push(ModelStreamEvent::Completed {
        reason: FinishReason::ToolCalls,
        end_turn: None,
    });
    let (transport, sink, ids, request) = setup(vec![events, answer()]);
    let release = Arc::new(Notify::new());
    let tools = LargeTools {
        release: release.clone(),
        starts: Mutex::new(vec![]),
        receipts: AtomicUsize::new(0),
    };
    let fault = FailLarge {
        sink: &sink,
        release,
        chunks: AtomicUsize::new(0),
    };
    let mut limits = limits();
    limits.tool_output_bytes = 64;
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(2),
        TurnRunner {
            transport: &transport,
            tools: &tools,
            sink: &fault,
            ids: &ids,
            limits,
        }
        .run(Uuid::from_u128(2), request),
    )
    .await
    .unwrap();
    assert!(matches!(result, Err(RunError::EventSink)));
    assert_eq!(*tools.starts.lock().unwrap(), ["running"]);
    assert_eq!(tools.receipts.load(Ordering::SeqCst), 0);
    assert_eq!(transport.requests.lock().unwrap().len(), 1);
    let projection = sink.projection.lock().unwrap();
    assert!(projection.has_unknown_tool_outcome());
    assert!(
        projection
            .turn(Uuid::from_u128(2))
            .unwrap()
            .items
            .values()
            .any(|item| matches!(item.kind, ItemKind::ToolResult { .. })
                && !item.completed
                && item.text == "🦀".repeat(65_536))
    );
}

struct CleanupState {
    released: AtomicBool,
    changed: Notify,
    starts: Mutex<Vec<String>>,
    finished: AtomicUsize,
    receipts: AtomicUsize,
}
struct CleanupTools(Arc<CleanupState>);
impl ToolExecutor for CleanupTools {
    fn validate(&self, _: &ToolCall) -> Result<(), RunError> {
        Ok(())
    }
    fn authorize_and_execute(&self, call: ToolCall) -> RunFuture<'_, ToolOutput> {
        Box::pin(async move {
            self.0.starts.lock().unwrap().push(call.call_id.clone());
            while !self.0.released.load(Ordering::SeqCst) {
                self.0.changed.notified().await;
            }
            tokio::task::yield_now().await;
            self.0.finished.fetch_add(1, Ordering::SeqCst);
            Ok(ToolOutput {
                content: call.call_id,
                is_error: false,
            })
        })
    }
    fn result_committed(&self, _: ToolCall) -> RunFuture<'_, ()> {
        self.0.receipts.fetch_add(1, Ordering::SeqCst);
        Box::pin(async { Ok(()) })
    }
}
struct FailFinished<'a> {
    sink: &'a Sink,
    state: Arc<CleanupState>,
}
impl TurnEventSink for FailFinished<'_> {
    fn emit(&self, payload: EventPayload) -> RunFuture<'_, ()> {
        Box::pin(async move {
            if matches!(payload, EventPayload::ModelRequestFinished { .. }) {
                self.state.released.store(true, Ordering::SeqCst);
                self.state.changed.notify_one();
                return Err(RunError::EventSink);
            }
            self.sink.emit(payload).await
        })
    }
}

#[tokio::test]
async fn persistence_failure_drains_running_owner_without_starting_waiting_effects_or_acknowledging()
 {
    let mut events = vec![begin()];
    events.extend(call("running", "{}"));
    events.extend(call("waiting", "{}"));
    events.push(ModelStreamEvent::Completed {
        reason: FinishReason::ToolCalls,
        end_turn: None,
    });
    let (transport, sink, ids, request) = setup(vec![events]);
    let state = Arc::new(CleanupState {
        released: AtomicBool::new(false),
        changed: Notify::new(),
        starts: Mutex::new(vec![]),
        finished: AtomicUsize::new(0),
        receipts: AtomicUsize::new(0),
    });
    let tools = CleanupTools(state.clone());
    let failed = FailFinished {
        sink: &sink,
        state: state.clone(),
    };
    let runner = TurnRunner {
        transport: &transport,
        tools: &tools,
        sink: &failed,
        ids: &ids,
        limits: limits(),
    };
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(2),
        runner.run(Uuid::from_u128(2), request),
    )
    .await
    .unwrap();
    assert!(matches!(result, Err(RunError::EventSink)));
    assert_eq!(*state.starts.lock().unwrap(), ["running"]);
    assert_eq!(
        state.finished.load(Ordering::SeqCst),
        1,
        "await the running owner's teardown"
    );
    assert_eq!(
        state.receipts.load(Ordering::SeqCst),
        0,
        "no durable result, no receipt"
    );
    let projection = sink.projection.lock().unwrap();
    let turn = projection.turn(Uuid::from_u128(2)).unwrap();
    assert_eq!(
        turn.items
            .values()
            .filter(|item| matches!(item.kind, ItemKind::ToolCall { .. }) && item.completed)
            .count(),
        2,
        "waiting intent remains a recovery barrier"
    );
    assert_eq!(transport.requests.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn explicit_owner_cancellation_is_paired_but_never_receipted_or_resampled() {
    struct CanceledTools(AtomicUsize);
    impl ToolExecutor for CanceledTools {
        fn validate(&self, _: &ToolCall) -> Result<(), RunError> {
            Ok(())
        }
        fn authorize_and_execute(&self, _: ToolCall) -> RunFuture<'_, ToolOutput> {
            self.0.fetch_add(1, Ordering::SeqCst);
            Box::pin(async {
                tokio::task::yield_now().await;
                Err(ModelError::Canceled.into())
            })
        }
        fn result_committed(&self, _: ToolCall) -> RunFuture<'_, ()> {
            panic!("a canceled owner reported no retained result")
        }
    }
    let mut events = tool_response();
    let extra = call("not-started-after-cancel", "{}");
    events.splice(events.len() - 1..events.len() - 1, extra);
    events.insert(
        1,
        ModelStreamEvent::Usage(ModelUsage {
            input_tokens: Some(10),
            output_tokens: Some(3),
        }),
    );
    let (transport, sink, ids, request) = setup(vec![events, answer()]);
    let tools = CanceledTools(AtomicUsize::new(0));
    let result = TurnRunner {
        transport: &transport,
        tools: &tools,
        sink: &sink,
        ids: &ids,
        limits: limits(),
    }
    .run(Uuid::from_u128(2), request)
    .await;
    assert!(matches!(result, Err(RunError::Model(ModelError::Canceled))));
    assert_eq!(transport.requests.lock().unwrap().len(), 1);
    let projection = sink.projection.lock().unwrap();
    let turn = projection.turn(Uuid::from_u128(2)).unwrap();
    assert_eq!(turn.outcome, Some(TurnOutcome::Canceled));
    assert_eq!(tools.0.load(Ordering::SeqCst), 1);
    assert!(
        !projection.has_unknown_tool_outcome(),
        "known unstarted calls are durably paired"
    );
    assert!(
        turn.items
            .values()
            .any(|item| item.completed && item.text.contains("tool_not_started"))
    );
    assert_eq!(
        (turn.input_tokens, turn.output_tokens),
        (Some(10), Some(3)),
        "a later tool cancellation must retain known completed-response usage"
    );
    assert!(turn.items.values().any(|item| item.completed
        && item.text.contains("tool_canceled")
        && matches!(
            item.kind,
            ItemKind::ToolResult {
                is_error: Some(true),
                ..
            }
        )));
}

#[tokio::test]
async fn failed_tool_result_stays_failed_in_durable_projection_and_model_history() {
    struct FailedTools(AtomicUsize);
    impl ToolExecutor for FailedTools {
        fn validate(&self, _: &ToolCall) -> Result<(), RunError> {
            Ok(())
        }
        fn authorize_and_execute(&self, _: ToolCall) -> RunFuture<'_, ToolOutput> {
            Box::pin(async {
                Ok(ToolOutput {
                    content: "file missing".into(),
                    is_error: true,
                })
            })
        }
        fn result_committed(&self, _: ToolCall) -> RunFuture<'_, ()> {
            self.0.fetch_add(1, Ordering::SeqCst);
            Box::pin(async { Ok(()) })
        }
    }
    let (transport, sink, ids, request) = setup(vec![tool_response(), answer()]);
    let tools = FailedTools(AtomicUsize::new(0));
    TurnRunner {
        transport: &transport,
        tools: &tools,
        sink: &sink,
        ids: &ids,
        limits: limits(),
    }
    .run(Uuid::from_u128(2), request)
    .await
    .unwrap();
    assert_eq!(
        tools.0.load(Ordering::SeqCst),
        1,
        "actual error results still own a receipt"
    );
    let requests = transport.requests.lock().unwrap();
    assert!(matches!(
        &requests[1].messages[2],
        ModelMessage::ToolResult { is_error: true, .. }
    ));
    let projection = sink.projection.lock().unwrap();
    assert!(
        projection
            .turn(Uuid::from_u128(2))
            .unwrap()
            .items
            .values()
            .any(|item| matches!(
                item.kind,
                ItemKind::ToolResult {
                    is_error: Some(true),
                    ..
                }
            ))
    );
}

#[tokio::test]
async fn execution_rejection_becomes_a_tool_result_for_model_continuation() {
    struct RejectedExecution;
    impl ToolExecutor for RejectedExecution {
        fn validate(&self, _: &ToolCall) -> Result<(), RunError> {
            Ok(())
        }
        fn authorize_and_execute(&self, _: ToolCall) -> RunFuture<'_, ToolOutput> {
            Box::pin(async { Err(RunError::ToolRejected) })
        }
        fn result_committed(&self, _: ToolCall) -> RunFuture<'_, ()> {
            panic!("synthetic execution rejection owns no executor receipt")
        }
    }
    let (transport, sink, ids, request) = setup(vec![tool_response(), answer()]);
    TurnRunner {
        transport: &transport,
        tools: &RejectedExecution,
        sink: &sink,
        ids: &ids,
        limits: limits(),
    }
    .run(Uuid::from_u128(2), request)
    .await
    .unwrap();
    let requests = transport.requests.lock().unwrap();
    assert!(matches!(
        &requests[1].messages[2],
        ModelMessage::ToolResult {
            is_error: true,
            content,
            ..
        }
            if content.contains("\"code\":\"tool_rejected\"")
    ));
    let projection = sink.projection.lock().unwrap();
    assert!(
        projection
            .turn(Uuid::from_u128(2))
            .unwrap()
            .items
            .values()
            .any(|item| matches!(
                item.kind,
                ItemKind::ToolResult {
                    is_error: Some(true),
                    ..
                }
            ))
    );
}
