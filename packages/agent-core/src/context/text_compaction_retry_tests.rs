use super::*;
use crate::{
    resilience::RetryPolicy,
    runner::{RetryWait, RunFuture},
};

struct Scripted {
    requests: Mutex<Vec<ModelRequest>>,
    failures: Mutex<VecDeque<Option<ModelError>>>,
}
impl ModelTransport for Scripted {
    fn capabilities(&self) -> ModelCapabilities {
        transport(events()).capabilities()
    }
    fn start(&self, request: ModelRequest) -> ModelFuture<'_, Box<dyn ModelStream>> {
        self.requests.lock().unwrap().push(request);
        let failure = self
            .failures
            .lock()
            .unwrap()
            .pop_front()
            .expect("bounded attempts");
        Box::pin(async move {
            if let Some(error) = failure {
                return Err(error);
            }
            Ok(Box::new(Stream {
                events: events().into(),
                blocked: false,
                dropped: Arc::new(AtomicBool::new(false)),
            }) as Box<dyn ModelStream>)
        })
    }
}
#[derive(Default)]
struct Wait(Mutex<Vec<u64>>);
impl RetryWait for Wait {
    fn wait(&self, delay: u64) -> RunFuture<'_, ()> {
        self.0.lock().unwrap().push(delay);
        Box::pin(async { Ok(()) })
    }
}
fn scripted(failures: Vec<Option<ModelError>>) -> Arc<Scripted> {
    Arc::new(Scripted {
        requests: Mutex::new(vec![]),
        failures: Mutex::new(failures.into()),
    })
}
fn retry_policy() -> RetryPolicy {
    RetryPolicy {
        max_attempts: 2,
        base_delay_ms: 5,
        max_delay_ms: 10,
    }
}

#[tokio::test]
async fn dropping_backoff_cannot_issue_another_request() {
    struct PendingWait;
    impl RetryWait for PendingWait {
        fn wait(&self, _: u64) -> RunFuture<'_, ()> {
            Box::pin(std::future::pending())
        }
    }
    let input = request();
    let transport = scripted(vec![Some(ModelError::Unavailable), None]);
    let strategy = TextCompactionStrategy::new(transport.clone(), input.binding.clone())
        .unwrap()
        .with_retry_policy(retry_policy(), Arc::new(PendingWait))
        .unwrap();
    let mut operation = Box::pin(prepare_compaction(&strategy, input));
    let mut context = std::task::Context::from_waker(std::task::Waker::noop());
    assert!(std::future::Future::poll(operation.as_mut(), &mut context).is_pending());
    assert_eq!(transport.requests.lock().unwrap().len(), 1);
    drop(operation);
    assert_eq!(transport.requests.lock().unwrap().len(), 1);
    assert_eq!(transport.failures.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn retry_discards_partial_summary_before_success() {
    struct Broken(VecDeque<ModelStreamEvent>);
    impl ModelStream for Broken {
        fn next(&mut self) -> ModelFuture<'_, Option<ModelStreamEvent>> {
            Box::pin(async move { self.0.pop_front().map(Some).ok_or(ModelError::Unavailable) })
        }
    }
    struct Partial(Arc<Scripted>);
    impl ModelTransport for Partial {
        fn capabilities(&self) -> ModelCapabilities {
            self.0.capabilities()
        }
        fn start(&self, request: ModelRequest) -> ModelFuture<'_, Box<dyn ModelStream>> {
            if self.0.requests.lock().unwrap().is_empty() {
                self.0.requests.lock().unwrap().push(request);
                return Box::pin(async {
                    Ok(Box::new(Broken(VecDeque::from([
                        events()[0].clone(),
                        ModelStreamEvent::TextDelta("discarded partial".into()),
                    ]))) as Box<dyn ModelStream>)
                });
            }
            self.0.start(request)
        }
    }
    let input = request();
    let inner = scripted(vec![None]);
    let strategy =
        TextCompactionStrategy::new(Arc::new(Partial(inner.clone())), input.binding.clone())
            .unwrap()
            .with_retry_policy(retry_policy(), Arc::new(Wait::default()))
            .unwrap();
    let candidate = prepare_compaction(&strategy, input).await.unwrap();
    assert!(
        candidate.output
            == CompactionOutput::TextSummary("progress with paper:v3#paragraph-4".into())
    );
    assert_eq!(inner.requests.lock().unwrap().len(), 2);
}

#[tokio::test]
async fn context_shrink_preserves_instructions_prompt_and_removes_tool_pairs() {
    let input = request();
    let transport = scripted(vec![
        Some(ModelError::ContextWindowExceeded),
        Some(ModelError::ContextWindowExceeded),
        None,
    ]);
    let strategy = TextCompactionStrategy::new(transport.clone(), input.binding.clone()).unwrap();
    prepare_compaction(&strategy, input.clone()).await.unwrap();
    let requests = transport.requests.lock().unwrap();
    assert_eq!(
        requests
            .iter()
            .map(|r| r.messages.len())
            .collect::<Vec<_>>(),
        [5, 4, 2]
    );
    assert!(
        matches!(&requests[2].messages[0], ModelMessage::System(text) if text == "current research rules")
    );
    assert!(
        matches!(&requests[2].messages[1], ModelMessage::User { content:parts, .. } if matches!(&parts[0], ContentPart::Text(text) if text == HANDOFF_PROMPT))
    );
    assert_eq!(input.source.messages.len(), 4);
}

#[tokio::test]
async fn shrinking_resets_transient_retry_budget() {
    let input = request();
    let transport = scripted(vec![
        Some(ModelError::Unavailable),
        Some(ModelError::ContextWindowExceeded),
        Some(ModelError::Unavailable),
        None,
    ]);
    let wait = Arc::new(Wait::default());
    let strategy = TextCompactionStrategy::new(transport.clone(), input.binding.clone())
        .unwrap()
        .with_retry_policy(retry_policy(), wait.clone())
        .unwrap();
    prepare_compaction(&strategy, input).await.unwrap();
    assert_eq!(*wait.0.lock().unwrap(), [5, 5]);
    assert_eq!(transport.requests.lock().unwrap().len(), 4);
}

#[tokio::test]
async fn terminal_errors_never_shrink_or_retry_and_transient_errors_are_bounded() {
    for error in [
        ModelError::Authentication,
        ModelError::Canceled,
        ModelError::UsageLimitReached,
        ModelError::InvalidRequest,
        ModelError::Unavailable,
    ] {
        let input = request();
        let transport = scripted(vec![Some(error), Some(error)]);
        let strategy = TextCompactionStrategy::new(transport.clone(), input.binding.clone())
            .unwrap()
            .with_retry_policy(retry_policy(), Arc::new(Wait::default()))
            .unwrap();
        assert!(
            matches!(prepare_compaction(&strategy, input).await, Err(CompactionFailure::Model(actual)) if actual == error)
        );
        let requests = transport.requests.lock().unwrap();
        assert_eq!(
            requests.len(),
            if error == ModelError::Unavailable {
                2
            } else {
                1
            }
        );
        assert!(requests.iter().all(|r| r.messages.len() == 5));
    }
}

#[tokio::test]
async fn capacity_error_with_only_rules_and_handoff_is_terminal() {
    let mut input = request();
    input.source.messages.truncate(1);
    let transport = scripted(vec![Some(ModelError::ContextWindowExceeded)]);
    let strategy = TextCompactionStrategy::new(transport.clone(), input.binding.clone()).unwrap();
    assert!(matches!(
        prepare_compaction(&strategy, input).await,
        Err(CompactionFailure::Model(ModelError::ContextWindowExceeded))
    ));
    assert_eq!(transport.requests.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn known_local_capacity_shrinks_before_network_io() {
    use crate::context::accounting::{ContextAccounting, Utf8JsonTokenEstimator};
    struct Accounted(Arc<Transport>, Arc<ContextAccounting>);
    impl ModelTransport for Accounted {
        fn capabilities(&self) -> ModelCapabilities {
            self.0.capabilities()
        }
        fn context_accounting(&self) -> Option<Arc<ContextAccounting>> {
            Some(self.1.clone())
        }
        fn start(&self, request: ModelRequest) -> ModelFuture<'_, Box<dyn ModelStream>> {
            self.0.start(request)
        }
    }
    let mut input = request();
    input.source.messages.insert(
        1,
        ModelMessage::User {
            content: vec![ContentPart::Text("old".repeat(2000))],
            source_item_id: None,
        },
    );
    let inner = transport(events());
    let transport = Arc::new(Accounted(
        inner.clone(),
        Arc::new(ContextAccounting {
            model: input.binding.model.clone(),
            unknown_window_trigger_tokens: None,
            budget: Some(CompactionBudget {
                context_window_tokens: 400,
                effective_percent: 100,
                configured_trigger_tokens: None,
                output_reserve_tokens: 0,
            }),
            estimator: Arc::new(Utf8JsonTokenEstimator),
        }),
    ));
    let strategy = TextCompactionStrategy::new(transport, input.binding.clone()).unwrap();
    prepare_compaction(&strategy, input).await.unwrap();
    let requests = inner.requests.lock().unwrap();
    assert_eq!(requests.len(), 1);
    assert_eq!(requests[0].messages.len(), 5);
}

#[test]
fn over_window_shrinking_preserves_developer_authority_and_handoff_prompt() {
    let mut source = request().source;
    source.messages = vec![
        ModelMessage::System("base".into()),
        ModelMessage::Developer("trusted guidance".into()),
        ModelMessage::User {
            content: vec![ContentPart::Text("old history".into())],
            source_item_id: None,
        },
        ModelMessage::User {
            content: vec![ContentPart::Text("handoff prompt".into())],
            source_item_id: None,
        },
    ];
    assert!(retry::remove_oldest(&mut source));
    assert_eq!(source.messages.len(), 3);
    assert!(
        matches!(&source.messages[1], ModelMessage::Developer(text) if text == "trusted guidance")
    );
    assert!(!retry::remove_oldest(&mut source));
}
