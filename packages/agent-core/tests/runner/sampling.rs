use super::*;

#[path = "sampling/end_turn.rs"]
mod end_turn;
#[path = "sampling/natural_end.rs"]
mod natural_end;

#[derive(Clone, Copy)]
enum Mutation {
    Model,
    Tools,
    Namespace,
    OutputLimit,
    Parallel,
    Reasoning,
}

struct Boundary {
    followups: Mutex<Vec<bool>>,
    fail: Option<ModelError>,
    mutation: Option<Mutation>,
    compact_without_followup: bool,
}
impl SamplingContext for Boundary {
    fn prepare(
        &self,
        _: Uuid,
        mut request: ModelRequest,
        followup: bool,
    ) -> RunFuture<'_, PreparedSamplingContext> {
        Box::pin(async move {
            self.followups.lock().unwrap().push(followup);
            if let Some(error) = self.fail {
                return Err(error.into());
            }
            if let Some(mutation) = self.mutation {
                match mutation {
                    Mutation::Model => request.model.provider_id = "unauthorized".into(),
                    Mutation::Tools => {
                        request.tools[0].parameters =
                            json!({"type":"object","properties":{"scope":{"const":"unauthorized"}}})
                    }
                    Mutation::Namespace => request.tools[0].namespace = Some("unauthorized".into()),
                    Mutation::OutputLimit => request.max_output_tokens += 1,
                    Mutation::Parallel => request.parallel_tool_calls = true,
                    Mutation::Reasoning => request.reasoning_effort = Some("unauthorized".into()),
                }
            }
            if !followup {
                assert!(
                    !has_steer(&request),
                    "pending input must not enter the compression snapshot"
                );
            }
            if followup {
                assert!(request.messages.iter().any(|message| matches!(message,
                    ModelMessage::ToolResult { content, .. } if content == "source text")));
                request.messages = vec![ModelMessage::User {
                    content: vec![ContentPart::Text(
                        "installed handoff: source text; read completed".into(),
                    )],
                    source_item_id: None,
                }];
            }
            Ok(PreparedSamplingContext {
                request,
                compacted: followup || self.compact_without_followup,
            })
        })
    }
}
fn boundary() -> Boundary {
    Boundary {
        followups: Mutex::new(vec![]),
        fail: None,
        mutation: None,
        compact_without_followup: false,
    }
}

#[tokio::test]
async fn compaction_without_old_followup_allows_new_input_before_sampling() {
    let (transport, sink, ids, request) = setup(vec![answer(), answer()]);
    let tools = Tools {
        sink: &sink,
        executed: AtomicUsize::new(0),
    };
    let input = pending(&sink);
    input
        .drains
        .lock()
        .unwrap()
        .push_back(vec![ModelMessage::User {
            content: vec![ContentPart::Text("arrived during compact".into())],
            source_item_id: None,
        }]);
    let mut boundary = boundary();
    boundary.compact_without_followup = true;
    let waits = Arc::new(Mutex::new(vec![]));
    TurnRunner {
        transport: &transport,
        tools: &tools,
        sink: &sink,
        ids: &ids,
        limits: limits(),
    }
    .run_with_sampling_context(
        Uuid::from_u128(2),
        request,
        &input,
        &RetryRecorder(waits),
        Some(&boundary),
    )
    .await
    .unwrap();
    let requests = transport.requests.lock().unwrap();
    assert_eq!(requests.len(), 2);
    assert!(has_steer(&requests[1]));
    assert!(requests[1].messages.iter().any(|message| matches!(message, ModelMessage::User { content: parts, .. }
        if parts.iter().any(|part| matches!(part, ContentPart::Text(text) if text == "arrived during compact")))));
    assert_eq!(*boundary.followups.lock().unwrap(), vec![false]);
    assert_eq!(tools.executed.load(Ordering::SeqCst), 0);
}
fn pending(sink: &Sink) -> Input<'_> {
    Input {
        sink,
        drains: Mutex::new(VecDeque::from([vec![ModelMessage::User {
            content: vec![ContentPart::Text("steer during compact".into())],
            source_item_id: None,
        }]])),
        closing: Mutex::new(vec![]),
        next_id: AtomicU64::new(1000),
    }
}
fn has_steer(request: &ModelRequest) -> bool {
    request.messages.iter().any(|message| matches!(message, ModelMessage::User { content: parts, .. }
        if parts.iter().any(|part| matches!(part, ContentPart::Text(text) if text == "steer during compact"))))
}

#[tokio::test]
async fn installed_mid_turn_window_resumes_tool_result_before_consuming_pending_steer() {
    let (transport, sink, ids, request) = setup(vec![tool_response(), answer(), answer()]);
    let tools = Tools {
        sink: &sink,
        executed: AtomicUsize::new(0),
    };
    let input = pending(&sink);
    let boundary = boundary();
    let waits = Arc::new(Mutex::new(vec![]));
    TurnRunner {
        transport: &transport,
        tools: &tools,
        sink: &sink,
        ids: &ids,
        limits: limits(),
    }
    .run_with_sampling_context(
        Uuid::from_u128(2),
        request,
        &input,
        &RetryRecorder(waits),
        Some(&boundary),
    )
    .await
    .unwrap();
    let requests = transport.requests.lock().unwrap();
    assert_eq!(requests.len(), 3);
    assert!(!has_steer(&requests[1]));
    assert!(has_steer(&requests[2]));
    assert_eq!(tools.executed.load(Ordering::SeqCst), 1);
    assert_eq!(*boundary.followups.lock().unwrap(), vec![true, false]);
    assert_eq!(*input.closing.lock().unwrap(), vec![true, false, true]);
    assert_eq!(
        sink.projection
            .lock()
            .unwrap()
            .turn(Uuid::from_u128(2))
            .unwrap()
            .outcome,
        Some(TurnOutcome::Completed)
    );
}

struct RetryAfterTool<'a> {
    inner: &'a Transport,
    starts: AtomicUsize,
}
impl ModelTransport for RetryAfterTool<'_> {
    fn capabilities(&self) -> ModelCapabilities {
        self.inner.capabilities()
    }
    fn start(&self, request: ModelRequest) -> ModelFuture<'_, Box<dyn ModelStream>> {
        if self.starts.fetch_add(1, Ordering::SeqCst) == 1 {
            self.inner.failures.store(1, Ordering::SeqCst);
        }
        self.inner.start(request)
    }
}

#[tokio::test]
async fn safe_retry_does_not_recompact_or_unlock_steer_before_the_old_followup() {
    let (transport, sink, ids, request) = setup(vec![tool_response(), answer(), answer()]);
    let retry = RetryAfterTool {
        inner: &transport,
        starts: AtomicUsize::new(0),
    };
    let tools = Tools {
        sink: &sink,
        executed: AtomicUsize::new(0),
    };
    let input = pending(&sink);
    let boundary = boundary();
    let waits = Arc::new(Mutex::new(vec![]));
    let mut limits = limits();
    limits.model_calls = Some(4);
    TurnRunner {
        transport: &retry,
        tools: &tools,
        sink: &sink,
        ids: &ids,
        limits,
    }
    .run_with_sampling_context(
        Uuid::from_u128(2),
        request,
        &input,
        &RetryRecorder(waits.clone()),
        Some(&boundary),
    )
    .await
    .unwrap();
    let requests = transport.requests.lock().unwrap();
    assert_eq!(requests.len(), 4);
    assert!(!has_steer(&requests[1]));
    assert!(!has_steer(&requests[2]));
    assert!(has_steer(&requests[3]));
    assert_eq!(*boundary.followups.lock().unwrap(), vec![true, false]);
    assert_eq!(tools.executed.load(Ordering::SeqCst), 1);
    assert_eq!(waits.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn failed_or_canceled_compaction_preserves_pending_input_and_durable_tool_result() {
    for error in [ModelError::Unavailable, ModelError::Canceled] {
        let (transport, sink, ids, request) = setup(vec![tool_response()]);
        let tools = Tools {
            sink: &sink,
            executed: AtomicUsize::new(0),
        };
        let input = pending(&sink);
        let mut boundary = boundary();
        boundary.fail = Some(error);
        let waits = Arc::new(Mutex::new(vec![]));
        let result = TurnRunner {
            transport: &transport,
            tools: &tools,
            sink: &sink,
            ids: &ids,
            limits: limits(),
        }
        .run_with_sampling_context(
            Uuid::from_u128(2),
            request,
            &input,
            &RetryRecorder(waits),
            Some(&boundary),
        )
        .await;
        assert!(matches!(result, Err(RunError::Model(actual)) if actual == error));
        assert_eq!(transport.requests.lock().unwrap().len(), 1);
        assert_eq!(tools.executed.load(Ordering::SeqCst), 1);
        assert!(input.closing.lock().unwrap().is_empty());
        assert_eq!(input.drains.lock().unwrap().len(), 1);
        let projection = sink.projection.lock().unwrap();
        let turn = projection.turn(Uuid::from_u128(2)).unwrap();
        assert!(
            turn.items
                .values()
                .any(|item| matches!(item.kind, ItemKind::ToolResult { .. }) && item.completed)
        );
        assert_eq!(
            turn.outcome,
            Some(if error == ModelError::Canceled {
                TurnOutcome::Canceled
            } else {
                TurnOutcome::Failed
            })
        );
    }
}

#[tokio::test]
async fn context_adapter_cannot_change_frozen_model_tools_or_execution_policy() {
    for mutation in [
        Mutation::Model,
        Mutation::Tools,
        Mutation::Namespace,
        Mutation::OutputLimit,
        Mutation::Parallel,
        Mutation::Reasoning,
    ] {
        let (transport, sink, ids, mut request) = setup(vec![tool_response()]);
        if matches!(mutation, Mutation::Namespace) {
            request.tools[0].namespace = Some("original".into());
        }
        let tools = Tools {
            sink: &sink,
            executed: AtomicUsize::new(0),
        };
        let input = pending(&sink);
        let mut boundary = boundary();
        boundary.mutation = Some(mutation);
        let waits = Arc::new(Mutex::new(vec![]));
        let result = TurnRunner {
            transport: &transport,
            tools: &tools,
            sink: &sink,
            ids: &ids,
            limits: limits(),
        }
        .run_with_sampling_context(
            Uuid::from_u128(2),
            request,
            &input,
            &RetryRecorder(waits),
            Some(&boundary),
        )
        .await;
        assert!(matches!(
            result,
            Err(RunError::Model(ModelError::InvalidRequest))
        ));
        assert_eq!(transport.requests.lock().unwrap().len(), 1);
        assert!(input.closing.lock().unwrap().is_empty());
        assert_eq!(tools.executed.load(Ordering::SeqCst), 1);
        let projection = sink.projection.lock().unwrap();
        assert!(
            projection
                .turn(Uuid::from_u128(2))
                .unwrap()
                .items
                .values()
                .any(|item| matches!(item.kind, ItemKind::ToolResult { .. }) && item.completed)
        );
    }
}

#[tokio::test]
async fn final_answer_without_pending_input_does_not_compact() {
    let (transport, sink, ids, request) = setup(vec![answer()]);
    let tools = Tools {
        sink: &sink,
        executed: AtomicUsize::new(0),
    };
    let input = Input {
        sink: &sink,
        drains: Mutex::new(VecDeque::new()),
        closing: Mutex::new(vec![]),
        next_id: AtomicU64::new(1000),
    };
    let boundary = boundary();
    let waits = Arc::new(Mutex::new(vec![]));
    TurnRunner {
        transport: &transport,
        tools: &tools,
        sink: &sink,
        ids: &ids,
        limits: limits(),
    }
    .run_with_sampling_context(
        Uuid::from_u128(2),
        request,
        &input,
        &RetryRecorder(waits),
        Some(&boundary),
    )
    .await
    .unwrap();
    assert!(boundary.followups.lock().unwrap().is_empty());
}

#[tokio::test]
async fn failed_steer_only_compaction_does_not_consume_or_commit_pending_input() {
    for failure in [ModelError::Canceled, ModelError::InvalidRequest] {
        let (transport, sink, ids, request) = setup(vec![answer()]);
        let tools = Tools {
            sink: &sink,
            executed: AtomicUsize::new(0),
        };
        let input = pending(&sink);
        let mut context = boundary();
        context.fail = Some(failure);
        let waits = Arc::new(Mutex::new(vec![]));
        let result = TurnRunner {
            transport: &transport,
            tools: &tools,
            sink: &sink,
            ids: &ids,
            limits: limits(),
        }
        .run_with_sampling_context(
            Uuid::from_u128(2),
            request,
            &input,
            &RetryRecorder(waits),
            Some(&context),
        )
        .await;
        assert!(matches!(result, Err(RunError::Model(error)) if error == failure));
        assert_eq!(input.drains.lock().unwrap().len(), 1);
        assert_eq!(*input.closing.lock().unwrap(), vec![true]);
        assert_eq!(transport.requests.lock().unwrap().len(), 1);
        assert!(
            !sink
                .projection
                .lock()
                .unwrap()
                .turn(Uuid::from_u128(2))
                .unwrap()
                .items
                .values()
                .any(|item| item.kind == ItemKind::UserMessage)
        );
        assert_eq!(tools.executed.load(Ordering::SeqCst), 0);
    }
}
