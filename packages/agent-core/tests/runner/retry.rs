use super::*;
#[path = "retry/steering.rs"]
mod input_during_retry;
#[path = "retry/partial.rs"]
mod partial;
#[path = "retry/reasoning.rs"]
mod reasoning;

#[tokio::test]
async fn transient_model_failure_uses_host_backoff_before_retrying() {
    let (transport, sink, ids, request) = setup(vec![answer()]);
    transport.failures.store(1, Ordering::SeqCst);
    let tools = Tools {
        sink: &sink,
        executed: AtomicUsize::new(0),
    };
    let delays = Arc::new(Mutex::new(Vec::new()));
    let result = TurnRunner {
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
        &RetryRecorder(delays.clone()),
    )
    .await
    .unwrap();
    assert_eq!(result.responses.len(), 1);
    assert_eq!(delays.lock().unwrap().as_slice(), &[250]);
    let projection = sink.projection.lock().unwrap();
    let turn = projection.turn(Uuid::from_u128(2)).unwrap();
    assert!(
        turn.items
            .values()
            .all(|item| !matches!(item.kind, ItemKind::AssistantMessage) || !item.text.is_empty())
    );
}
#[tokio::test]
async fn incomplete_stream_without_output_can_retry_without_replaying_text() {
    let (transport, sink, ids, request) = setup(vec![vec![], answer()]);
    let tools = Tools {
        sink: &sink,
        executed: AtomicUsize::new(0),
    };
    let delays = Arc::new(Mutex::new(vec![]));
    let result = TurnRunner {
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
        &RetryRecorder(delays.clone()),
    )
    .await
    .unwrap();
    assert_eq!(result.responses.len(), 1);
    assert_eq!(delays.lock().unwrap().as_slice(), &[250]);
}

enum Step {
    StartError(ModelError),
    Stream(Vec<Result<ModelStreamEvent, ModelError>>),
}
fn response(events: Vec<ModelStreamEvent>) -> Step {
    Step::Stream(events.into_iter().map(Ok).collect())
}
fn failure(error: ModelError, in_stream: bool) -> Step {
    if in_stream {
        Step::Stream(vec![Ok(begin()), Err(error)])
    } else {
        Step::StartError(error)
    }
}
struct Script {
    steps: Mutex<VecDeque<Step>>,
    requests: Mutex<Vec<ModelRequest>>,
    drops: Arc<AtomicUsize>,
}
struct ErrorStream {
    events: VecDeque<Result<ModelStreamEvent, ModelError>>,
    drops: Arc<AtomicUsize>,
}
impl Drop for ErrorStream {
    fn drop(&mut self) {
        self.drops.fetch_add(1, Ordering::SeqCst);
    }
}
impl ModelStream for ErrorStream {
    fn next(&mut self) -> ModelFuture<'_, Option<ModelStreamEvent>> {
        Box::pin(async move { self.events.pop_front().transpose() })
    }
}
impl ModelTransport for Script {
    fn capabilities(&self) -> ModelCapabilities {
        ModelCapabilities {
            vision: true,
            tools: true,
            parallel_tools: false,
            reasoning_efforts: vec![],
        }
    }
    fn start(&self, request: ModelRequest) -> ModelFuture<'_, Box<dyn ModelStream>> {
        Box::pin(async move {
            self.requests.lock().unwrap().push(request);
            match self
                .steps
                .lock()
                .unwrap()
                .pop_front()
                .expect("unexpected sampling")
            {
                Step::StartError(error) => Err(error),
                Step::Stream(events) => Ok(Box::new(ErrorStream {
                    events: events.into(),
                    drops: self.drops.clone(),
                }) as Box<dyn ModelStream>),
            }
        })
    }
}
fn script(steps: Vec<Step>) -> Script {
    Script {
        steps: Mutex::new(steps.into()),
        requests: Mutex::new(vec![]),
        drops: Arc::new(AtomicUsize::new(0)),
    }
}
fn tool_step(index: usize) -> Step {
    let mut events = vec![begin()];
    events.extend(call(&format!("call-{index}"), "{}"));
    events.push(ModelStreamEvent::Completed {
        reason: FinishReason::ToolCalls,
        end_turn: None,
    });
    response(events)
}
fn same_input(left: &ModelRequest, right: &ModelRequest) {
    assert!(left.messages == right.messages);
    assert!(left.tools == right.tools);
    assert_eq!(left.model, right.model);
    assert_eq!(left.max_output_tokens, right.max_output_tokens);
    assert_eq!(left.parallel_tool_calls, right.parallel_tool_calls);
    assert_eq!(left.reasoning_effort, right.reasoning_effort);
    assert_ne!(left.request_id, right.request_id);
}
#[tokio::test]
async fn overload_after_six_tools_retries_only_generation_with_identical_saved_results() {
    for in_stream in [false, true] {
        let (_, sink, ids, request) = setup(vec![]);
        let mut steps: Vec<_> = (0..6).map(tool_step).collect();
        steps.extend([
            failure(ModelError::ServerOverloaded, in_stream),
            failure(ModelError::ServerOverloaded, in_stream),
            response(answer()),
        ]);
        let transport = script(steps);
        let tools = Tools {
            sink: &sink,
            executed: AtomicUsize::new(0),
        };
        let waits = Arc::new(Mutex::new(vec![]));
        let mut budget = limits();
        budget.model_calls = Some(9);
        budget.tool_calls = Some(6);
        let result = TurnRunner {
            transport: &transport,
            tools: &tools,
            sink: &sink,
            ids: &ids,
            limits: budget,
        }
        .run_with_retry_wait(
            Uuid::from_u128(2),
            request,
            &NoAdditionalInputForTest,
            &RetryRecorder(waits.clone()),
        )
        .await
        .unwrap();
        assert_eq!(result.responses.len(), 7);
        assert_eq!(tools.executed.load(Ordering::SeqCst), 6);
        assert_eq!(*waits.lock().unwrap(), vec![250, 500]);
        let requests = transport.requests.lock().unwrap();
        assert_eq!(requests.len(), 9);
        same_input(&requests[6], &requests[7]);
        same_input(&requests[7], &requests[8]);
        assert_eq!(
            requests[8]
                .messages
                .iter()
                .filter(|m| matches!(m, ModelMessage::ToolResult { .. }))
                .count(),
            6
        );
        assert_eq!(
            requests[8]
                .messages
                .iter()
                .filter(|m| matches!(m, ModelMessage::User { content: _, .. }))
                .count(),
            1
        );
        let projection = sink.projection.lock().unwrap();
        let turn = projection.turn(Uuid::from_u128(2)).unwrap();
        assert_eq!(turn.outcome, Some(TurnOutcome::Completed));
        assert_eq!(
            turn.attempts
                .values()
                .filter(|a| a.outcome == Some(TurnOutcome::Failed))
                .count(),
            2
        );
        let history = reconstruct_history(&projection).unwrap();
        assert_eq!(
            history
                .iter()
                .filter(|m| matches!(m, ModelMessage::ToolResult { .. }))
                .count(),
            6
        );
        assert!(
            !history
                .iter()
                .any(|m| matches!(m, ModelMessage::User { content: _, .. }))
        ); // fixture has no durable user item
    }
}
#[tokio::test]
async fn successful_sampling_resets_the_next_requests_retry_allowance() {
    let (_, sink, ids, request) = setup(vec![]);
    let transport = script(vec![
        failure(ModelError::Unavailable, false),
        failure(ModelError::ServerOverloaded, true),
        tool_step(0),
        failure(ModelError::InternalServerError, true),
        failure(ModelError::RateLimited, true),
        response(answer()),
    ]);
    let tools = Tools {
        sink: &sink,
        executed: AtomicUsize::new(0),
    };
    let waits = Arc::new(Mutex::new(vec![]));
    let mut budget = limits();
    budget.model_calls = Some(6);
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
        &NoAdditionalInputForTest,
        &RetryRecorder(waits.clone()),
    )
    .await
    .unwrap();
    assert_eq!(*waits.lock().unwrap(), vec![250, 500, 250, 500]);
    assert_eq!(tools.executed.load(Ordering::SeqCst), 1);
    let requests = transport.requests.lock().unwrap();
    same_input(&requests[0], &requests[1]);
    same_input(&requests[1], &requests[2]);
    same_input(&requests[3], &requests[4]);
    same_input(&requests[4], &requests[5]);
}
#[tokio::test]
async fn retry_exhaustion_and_total_budget_preserve_the_provider_failure() {
    for call_budget in [Some(1), Some(2), Some(10), None] {
        let (_, sink, ids, request) = setup(vec![]);
        let transport = script(
            (0..6)
                .map(|_| failure(ModelError::ServerOverloaded, true))
                .collect(),
        );
        let tools = Tools {
            sink: &sink,
            executed: AtomicUsize::new(0),
        };
        let waits = Arc::new(Mutex::new(vec![]));
        let mut budget = limits();
        budget.model_calls = call_budget;
        let result = TurnRunner {
            transport: &transport,
            tools: &tools,
            sink: &sink,
            ids: &ids,
            limits: budget,
        }
        .run_with_retry_wait(
            Uuid::from_u128(2),
            request,
            &NoAdditionalInputForTest,
            &RetryRecorder(waits.clone()),
        )
        .await;
        assert!(matches!(
            result,
            Err(RunError::Model(ModelError::ServerOverloaded))
        ));
        let expected_attempts = call_budget.map_or(6, |max| max.min(6));
        assert_eq!(transport.requests.lock().unwrap().len(), expected_attempts);
        assert_eq!(waits.lock().unwrap().len(), expected_attempts - 1);
        assert_eq!(tools.executed.load(Ordering::SeqCst), 0);
        let projection = sink.projection.lock().unwrap();
        let turn = projection.turn(Uuid::from_u128(2)).unwrap();
        assert_eq!(turn.outcome, Some(TurnOutcome::Failed));
        assert!(
            turn.attempts
                .values()
                .all(|a| a.outcome == Some(TurnOutcome::Failed))
        );
    }
}
#[tokio::test]
async fn nontransient_errors_never_retry_and_drain_already_accepted_tools() {
    for error in [
        ModelError::Authentication,
        ModelError::ContextWindowExceeded,
        ModelError::UsageLimitReached,
        ModelError::Canceled,
    ] {
        for text in ["", "partial explanation"] {
            let (_, sink, ids, request) = setup(vec![]);
            let mut events = vec![Ok(begin())];
            if !text.is_empty() {
                events.push(Ok(ModelStreamEvent::TextDelta(text.into())));
            }
            events.extend(call("unexecuted", "{}").into_iter().map(Ok));
            events.push(Err(error));
            let transport = script(vec![Step::Stream(events)]);
            let tools = Tools {
                sink: &sink,
                executed: AtomicUsize::new(0),
            };
            let waits = Arc::new(Mutex::new(vec![]));
            let result = TurnRunner {
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
            .await;
            assert!(matches!(result,Err(RunError::Model(actual)) if actual==error));
            assert_eq!(transport.requests.lock().unwrap().len(), 1);
            assert_eq!(tools.executed.load(Ordering::SeqCst), 1);
            assert!(waits.lock().unwrap().is_empty());
            let projection = sink.projection.lock().unwrap();
            let turn = projection.turn(Uuid::from_u128(2)).unwrap();
            assert_eq!(
                turn.attempts.values().next().unwrap().outcome,
                Some(TurnOutcome::Failed)
            );
            assert_eq!(
                turn.outcome,
                Some(if error == ModelError::Canceled {
                    TurnOutcome::Canceled
                } else {
                    TurnOutcome::Failed
                })
            );
            assert_eq!(
                turn.items
                    .values()
                    .filter(|item| item.kind == ItemKind::AssistantMessage)
                    .map(|item| item.text.as_str())
                    .collect::<Vec<_>>(),
                if text.is_empty() { vec![] } else { vec![text] }
            );
        }
    }
}
struct PendingWait {
    drops: Arc<AtomicUsize>,
    waits: AtomicUsize,
}
impl RetryWait for PendingWait {
    fn wait(&self, _: u64) -> RunFuture<'_, ()> {
        assert_eq!(
            self.drops.load(Ordering::SeqCst),
            1,
            "failed stream must be released before backoff"
        );
        self.waits.fetch_add(1, Ordering::SeqCst);
        Box::pin(std::future::pending())
    }
}
#[test]
fn dropping_backoff_releases_owned_stream_and_does_not_start_another_request() {
    let (_, sink, ids, request) = setup(vec![]);
    let transport = script(vec![failure(ModelError::ServerOverloaded, true)]);
    let tools = Tools {
        sink: &sink,
        executed: AtomicUsize::new(0),
    };
    let wait = PendingWait {
        drops: transport.drops.clone(),
        waits: AtomicUsize::new(0),
    };
    let runner = TurnRunner {
        transport: &transport,
        tools: &tools,
        sink: &sink,
        ids: &ids,
        limits: limits(),
    };
    let mut run = Box::pin(runner.run_with_retry_wait(
        Uuid::from_u128(2),
        request,
        &NoAdditionalInputForTest,
        &wait,
    ));
    assert!(
        run.as_mut()
            .poll(&mut Context::from_waker(Waker::noop()))
            .is_pending()
    );
    assert_eq!(wait.waits.load(Ordering::SeqCst), 1);
    drop(run);
    assert_eq!(transport.requests.lock().unwrap().len(), 1);
    assert_eq!(transport.drops.load(Ordering::SeqCst), 1);
}
