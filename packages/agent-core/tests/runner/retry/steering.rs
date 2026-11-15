use super::*;
use std::sync::atomic::AtomicBool;

struct LateInput {
    available: AtomicBool,
    drains: AtomicUsize,
}
impl TurnInputSource for LateInput {
    fn has_pending(&self, _: Uuid) -> RunFuture<'_, bool> {
        Box::pin(async move { Ok(self.available.load(Ordering::SeqCst)) })
    }
    fn has_pending_or_seal(&self, _: Uuid) -> RunFuture<'_, bool> {
        Box::pin(async move { Ok(self.available.load(Ordering::SeqCst)) })
    }
    fn drain(&self, _: Uuid, _: bool) -> RunFuture<'_, Vec<ModelMessage>> {
        Box::pin(async move {
            self.drains.fetch_add(1, Ordering::SeqCst);
            Ok(if self.available.swap(false, Ordering::SeqCst) {
                vec![ModelMessage::User {
                    content: vec![ContentPart::Text("late steering".into())],
                    source_item_id: None,
                }]
            } else {
                vec![]
            })
        })
    }
}
struct AdmitDuringBackoff<'a>(&'a LateInput);
impl RetryWait for AdmitDuringBackoff<'_> {
    fn wait(&self, _: u64) -> RunFuture<'_, ()> {
        self.0.available.store(true, Ordering::SeqCst);
        Box::pin(async { Ok(()) })
    }
}
#[tokio::test]
async fn input_arriving_during_backoff_waits_until_the_retried_sample_completes() {
    let (_, sink, ids, request) = setup(vec![]);
    let transport = script(vec![
        tool_step(0),
        failure(ModelError::ServerOverloaded, true),
        response(answer()),
        response(answer()),
    ]);
    let tools = Tools {
        sink: &sink,
        executed: AtomicUsize::new(0),
    };
    let input = LateInput {
        available: AtomicBool::new(false),
        drains: AtomicUsize::new(0),
    };
    let mut budget = limits();
    budget.model_calls = Some(4);
    TurnRunner {
        transport: &transport,
        tools: &tools,
        sink: &sink,
        ids: &ids,
        limits: budget,
    }
    .run_with_retry_wait(
        Uuid::from_u128(2),
        request,
        &input,
        &AdmitDuringBackoff(&input),
    )
    .await
    .unwrap();
    let requests = transport.requests.lock().unwrap();
    assert_eq!(requests.len(), 4);
    same_input(&requests[1], &requests[2]);
    let users = |r: &ModelRequest| {
        r.messages
            .iter()
            .filter(|m| matches!(m, ModelMessage::User { content: _, .. }))
            .count()
    };
    assert_eq!(users(&requests[2]), 1);
    assert_eq!(users(&requests[3]), 2);
    assert_eq!(input.drains.load(Ordering::SeqCst), 2);
    assert_eq!(tools.executed.load(Ordering::SeqCst), 1);
}
#[tokio::test]
async fn incomplete_unexecuted_tool_arguments_are_discarded_before_safe_stream_retry() {
    let (_, sink, ids, request) = setup(vec![]);
    let events = vec![
        Ok(begin()),
        Ok(ModelStreamEvent::TextDelta("".into())),
        Ok(ModelStreamEvent::ToolCallStarted {
            call_id: "partial-tool".into(),
            name: "read".into(),
        }),
        Ok(ModelStreamEvent::ToolArgumentsDelta {
            call_id: "partial-tool".into(),
            delta: "{\"partial".into(),
        }),
        Err(ModelError::ServerOverloaded),
    ];
    let transport = script(vec![Step::Stream(events), response(answer())]);
    let tools = Tools {
        sink: &sink,
        executed: AtomicUsize::new(0),
    };
    let waits = Arc::new(Mutex::new(vec![]));
    TurnRunner {
        transport: &transport,
        tools: &tools,
        sink: &sink,
        ids: &ids,
        limits: limits(),
    }
    .run_with_retry_wait(
        Uuid::from_u128(2),
        request,
        &NoAdditionalInputForTest,
        &RetryRecorder(waits.clone()),
    )
    .await
    .unwrap();
    assert_eq!(tools.executed.load(Ordering::SeqCst), 0);
    assert_eq!(*waits.lock().unwrap(), vec![250]);
    let requests = transport.requests.lock().unwrap();
    same_input(&requests[0], &requests[1]);
    let projection = sink.projection.lock().unwrap();
    let turn = projection.turn(Uuid::from_u128(2)).unwrap();
    assert_eq!(turn.items.len(), 1);
    assert_eq!(turn.items.values().next().unwrap().text, "answer");
}
