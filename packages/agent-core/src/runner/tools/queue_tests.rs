use super::*;
use std::sync::{Arc, Mutex};
use tokio::sync::oneshot;

struct Executor {
    receiver: Mutex<Option<oneshot::Receiver<()>>>,
    started: Arc<Mutex<Vec<String>>>,
    canceled: bool,
}
impl ToolExecutor for Executor {
    fn validate(&self, _: &ToolCall) -> Result<(), RunError> {
        Ok(())
    }
    fn authorize_and_execute(&self, call: ToolCall) -> RunFuture<'_, ToolOutput> {
        self.started.lock().unwrap().push(call.call_id.clone());
        if call.call_id == "first" {
            let receiver = self.receiver.lock().unwrap().take().unwrap();
            let canceled = self.canceled;
            Box::pin(async move {
                receiver.await.unwrap();
                if canceled {
                    Err(ModelError::Canceled.into())
                } else {
                    Err(RunError::ToolOutcomeUnknown)
                }
            })
        } else {
            Box::pin(async {
                Ok(ToolOutput {
                    content: "result".into(),
                    is_error: false,
                })
            })
        }
    }
}
fn prepared(id: &str) -> PreparedTool {
    PreparedTool {
        intent: ToolCallIntent {
            call_id: id.into(),
            name: "read".into(),
            raw_arguments_json: "{}".into(),
            namespace: None,
        },
        call: Some(ToolCall {
            namespace: None,
            call_id: id.into(),
            name: "read".into(),
            arguments: serde_json::json!({}),
            raw_arguments_json: Some("{}".into()),
        }),
        call_id: Uuid::new_v5(&Uuid::NAMESPACE_OID, id.as_bytes()),
        feedback: None,
        failure: None,
        index: 0,
        parallel: true,
    }
}
async fn ready_terminal_owner_stops_new_parallel_work(canceled: bool) {
    let (send, receiver) = oneshot::channel();
    let started = Arc::new(Mutex::new(Vec::new()));
    let tools = Executor {
        receiver: Mutex::new(Some(receiver)),
        started: started.clone(),
        canceled,
    };
    let mut queue = ToolQueue::new(&tools);
    queue.admit(prepared("first"));
    std::future::poll_fn(|cx| {
        queue.poll(cx);
        Poll::Ready(())
    })
    .await;
    assert_eq!(*started.lock().unwrap(), ["first"]);
    queue.admit(prepared("second"));
    send.send(()).unwrap();
    let mut next: ModelFuture<'_, Option<ModelStreamEvent>> = Box::pin(std::future::pending());
    let result = queue.next(&mut next).await;
    if canceled {
        assert!(matches!(result, Err(RunError::Model(ModelError::Canceled))));
    } else {
        assert!(matches!(result, Err(RunError::ToolOutcomeUnknown)));
    }
    assert_eq!(*started.lock().unwrap(), ["first"]);
    if canceled {
        queue.abort_waiting();
    }
    let first = queue.next_result().await.unwrap();
    if canceled {
        assert!(
            first
                .result
                .as_ref()
                .is_ok_and(|execution| execution.canceled)
        );
    } else {
        assert!(matches!(first.result, Err(RunError::ToolOutcomeUnknown)));
        queue.abort_waiting();
    }
    queue.release_result();
    let second = queue.next_result().await.unwrap();
    assert!(
        second
            .result
            .as_ref()
            .is_ok_and(|execution| execution.output.is_error
                && execution.output.content.contains("tool_not_started"))
    );
    queue.release_result();
    assert!(queue.next_result().await.is_none());
    assert_eq!(*started.lock().unwrap(), ["first"]);
}
#[tokio::test]
async fn unknown_ready_owner_is_observed_before_dispatching_new_parallel_work() {
    ready_terminal_owner_stops_new_parallel_work(false).await;
}
#[tokio::test]
async fn canceled_ready_owner_is_observed_before_dispatching_new_parallel_work() {
    ready_terminal_owner_stops_new_parallel_work(true).await;
}

#[tokio::test]
async fn fatal_later_owner_stops_dispatch_even_while_an_earlier_owner_is_pending() {
    struct FatalLater {
        first: Mutex<Option<oneshot::Receiver<()>>>,
        second: Mutex<Option<oneshot::Receiver<()>>>,
        started: Arc<Mutex<Vec<String>>>,
    }
    impl ToolExecutor for FatalLater {
        fn validate(&self, _: &ToolCall) -> Result<(), RunError> {
            Ok(())
        }
        fn authorize_and_execute(&self, call: ToolCall) -> RunFuture<'_, ToolOutput> {
            self.started.lock().unwrap().push(call.call_id.clone());
            let receiver = if call.call_id == "first" {
                self.first.lock().unwrap().take()
            } else if call.call_id == "second" {
                self.second.lock().unwrap().take()
            } else {
                None
            };
            Box::pin(async move {
                if let Some(receiver) = receiver {
                    receiver.await.unwrap();
                }
                if call.call_id == "second" {
                    Err(RunError::Budget)
                } else {
                    Ok(ToolOutput {
                        content: "ok".into(),
                        is_error: false,
                    })
                }
            })
        }
    }
    let (first_send, first) = oneshot::channel();
    let (second_send, second) = oneshot::channel();
    let started = Arc::new(Mutex::new(Vec::new()));
    let tools = FatalLater {
        first: Mutex::new(Some(first)),
        second: Mutex::new(Some(second)),
        started: started.clone(),
    };
    let mut queue = ToolQueue::new(&tools);
    queue.admit(prepared("first"));
    queue.admit(prepared("second"));
    std::future::poll_fn(|cx| {
        queue.poll(cx);
        Poll::Ready(())
    })
    .await;
    queue.admit(prepared("third"));
    second_send.send(()).unwrap();
    let mut stream: ModelFuture<'_, Option<ModelStreamEvent>> = Box::pin(std::future::pending());
    assert!(matches!(
        queue.next(&mut stream).await,
        Err(RunError::Budget)
    ));
    assert_eq!(*started.lock().unwrap(), ["first", "second"]);
    queue.abort_waiting();
    first_send.send(()).unwrap();
    let first = queue.next_result().await.unwrap();
    assert!(first.result.is_ok());
    queue.release_result();
    let second = queue.next_result().await.unwrap();
    assert!(matches!(second.result, Err(RunError::Budget)));
    queue.release_result();
    let third = queue.next_result().await.unwrap();
    assert!(
        third
            .result
            .unwrap()
            .output
            .content
            .contains("tool_not_started")
    );
    queue.release_result();
    assert!(queue.next_result().await.is_none());
}

#[tokio::test]
async fn fatal_validation_feedback_stops_later_dispatch() {
    let (send, receiver) = oneshot::channel();
    let started = Arc::new(Mutex::new(Vec::new()));
    let tools = Executor {
        receiver: Mutex::new(Some(receiver)),
        started: started.clone(),
        canceled: false,
    };
    let mut queue = ToolQueue::new(&tools);
    let mut rejected = prepared("first");
    rejected.failure = Some(RunError::Budget);
    rejected.feedback = Some(tool_feedback::not_started());
    queue.admit(rejected);
    std::future::poll_fn(|cx| {
        queue.poll(cx);
        Poll::Ready(())
    })
    .await;
    queue.admit(prepared("second"));
    let mut stream: ModelFuture<'_, Option<ModelStreamEvent>> = Box::pin(std::future::pending());
    assert!(matches!(
        queue.next(&mut stream).await,
        Err(RunError::Budget)
    ));
    assert!(started.lock().unwrap().is_empty());
    queue.abort_waiting();
    let first = queue.next_result().await.unwrap();
    assert!(first.prepared.failure.is_some());
    queue.release_result();
    let second = queue.next_result().await.unwrap();
    assert!(
        second
            .result
            .unwrap()
            .output
            .content
            .contains("tool_not_started")
    );
    queue.release_result();
    assert!(queue.next_result().await.is_none());
    drop(send);
}

async fn ready_errors(second_error: RunError) -> RunError {
    struct Errors {
        first: Mutex<Option<oneshot::Receiver<()>>>,
        second: Mutex<Option<oneshot::Receiver<()>>>,
        second_error: RunError,
    }
    impl ToolExecutor for Errors {
        fn validate(&self, _: &ToolCall) -> Result<(), RunError> {
            Ok(())
        }
        fn authorize_and_execute(&self, call: ToolCall) -> RunFuture<'_, ToolOutput> {
            let first = call.call_id == "first";
            let receiver = if first {
                self.first.lock().unwrap().take().unwrap()
            } else {
                self.second.lock().unwrap().take().unwrap()
            };
            let error = if first {
                RunError::Budget
            } else {
                self.second_error.clone()
            };
            Box::pin(async move {
                receiver.await.unwrap();
                Err(error)
            })
        }
    }
    let (first_send, first) = oneshot::channel();
    let (second_send, second) = oneshot::channel();
    let errors = Errors {
        first: Mutex::new(Some(first)),
        second: Mutex::new(Some(second)),
        second_error,
    };
    let mut queue = ToolQueue::new(&errors);
    queue.admit(prepared("first"));
    queue.admit(prepared("second"));
    std::future::poll_fn(|cx| {
        queue.poll(cx);
        Poll::Ready(())
    })
    .await;
    first_send.send(()).unwrap();
    second_send.send(()).unwrap();
    std::future::poll_fn(|cx| {
        queue.poll(cx);
        Poll::Ready(())
    })
    .await;
    let mut stream: ModelFuture<'_, Option<ModelStreamEvent>> = Box::pin(std::future::pending());
    match queue.next(&mut stream).await {
        Err(error) => error,
        Ok(_) => panic!("expected fatal result"),
    }
}

#[tokio::test]
async fn persistence_failure_takes_precedence_over_an_earlier_fatal_result() {
    assert!(matches!(
        ready_errors(RunError::EventSink).await,
        RunError::EventSink
    ));
}

#[tokio::test]
async fn equal_priority_fatal_results_keep_original_call_order() {
    assert!(matches!(
        ready_errors(RunError::Model(ModelError::Unavailable)).await,
        RunError::Budget
    ));
}

#[tokio::test]
async fn fatal_result_does_not_start_an_admitted_but_unpolled_parallel_future() {
    struct Immediate {
        started: Arc<Mutex<Vec<String>>>,
    }
    impl ToolExecutor for Immediate {
        fn validate(&self, _: &ToolCall) -> Result<(), RunError> {
            Ok(())
        }
        fn authorize_and_execute(&self, call: ToolCall) -> RunFuture<'_, ToolOutput> {
            self.started.lock().unwrap().push(call.call_id.clone());
            Box::pin(async { Err(RunError::Budget) })
        }
    }
    let started = Arc::new(Mutex::new(Vec::new()));
    let tools = Immediate {
        started: started.clone(),
    };
    let mut queue = ToolQueue::new(&tools);
    queue.admit(prepared("first"));
    queue.admit(prepared("second"));
    let mut stream: ModelFuture<'_, Option<ModelStreamEvent>> = Box::pin(std::future::pending());
    assert!(matches!(
        queue.next(&mut stream).await,
        Err(RunError::Budget)
    ));
    assert_eq!(*started.lock().unwrap(), ["first"]);
    queue.abort_waiting();
    let first = queue.next_result().await.unwrap();
    assert!(matches!(first.result, Err(RunError::Budget)));
    queue.release_result();
    let second = queue.next_result().await.unwrap();
    assert!(
        second
            .result
            .unwrap()
            .output
            .content
            .contains("tool_not_started")
    );
    queue.release_result();
    assert!(queue.next_result().await.is_none());
    assert_eq!(*started.lock().unwrap(), ["first"]);
}

#[tokio::test]
async fn fatal_stop_preserves_already_prepared_feedback_without_executing_it() {
    for admitted_before_poll in [true, false] {
        struct Immediate;
        impl ToolExecutor for Immediate {
            fn validate(&self, _: &ToolCall) -> Result<(), RunError> {
                Ok(())
            }
            fn authorize_and_execute(&self, call: ToolCall) -> RunFuture<'_, ToolOutput> {
                assert_eq!(call.call_id, "first");
                Box::pin(async { Err(RunError::Budget) })
            }
        }
        let mut queue = ToolQueue::new(&Immediate);
        queue.admit(prepared("first"));
        if !admitted_before_poll {
            std::future::poll_fn(|cx| {
                queue.poll(cx);
                Poll::Ready(())
            })
            .await;
        }
        let mut rejected = prepared("second");
        rejected.feedback = Some(tool_feedback::invalid_arguments("Invalid field."));
        queue.admit(rejected);
        let mut stream: ModelFuture<'_, Option<ModelStreamEvent>> =
            Box::pin(std::future::pending());
        assert!(matches!(
            queue.next(&mut stream).await,
            Err(RunError::Budget)
        ));
        queue.abort_waiting();
        let first = queue.next_result().await.unwrap();
        assert!(matches!(first.result, Err(RunError::Budget)));
        queue.release_result();
        let second = queue.next_result().await.unwrap();
        assert!(
            second
                .result
                .unwrap()
                .output
                .content
                .contains("invalid_tool_arguments")
        );
        queue.release_result();
        assert!(queue.next_result().await.is_none());
    }
}
