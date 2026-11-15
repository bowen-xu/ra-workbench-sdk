use super::*;
use crate::{context::compaction_strategy::CompactionPhase, protocol::ModelIdentity};
use std::sync::Mutex;
use tokio::sync::{Barrier, Notify};

#[derive(Default)]
struct Observer(Mutex<Vec<(Uuid, CompactionHookNotification)>>);
impl HookHandlerObserver for Observer {
    fn notify(
        &self,
        id: Uuid,
        _: &CompactionHookRequest,
        notification: CompactionHookNotification,
    ) {
        self.0.lock().unwrap().push((id, notification));
    }
}

struct Hook {
    result: CompactionHookResult,
    barrier: Arc<Barrier>,
    gate: Arc<Notify>,
    wait: bool,
}

struct PhaseHook(CompactionPhase);
impl CompactionHooks for PhaseHook {
    fn notify(&self, _: &CompactionHookRequest, _: CompactionHookNotification) {}
    fn run(&self, _: CompactionHookRequest) -> CompactionHookFuture<'_> {
        Box::pin(async { CompactionHookOutcome::Continue })
    }
    fn accepts_request(&self, request: &CompactionHookRequest) -> bool {
        request.phase == self.0
    }
}

#[tokio::test]
async fn admission_and_dispatch_select_the_same_request_handlers() {
    let observer = Arc::new(Observer::default());
    let hooks = ConcurrentCompactionHooks::new(
        [CompactionPhase::Manual, CompactionPhase::MidTurn]
            .into_iter()
            .enumerate()
            .map(|(index, phase)| CompactionHookHandler {
                id: Uuid::from_u128(index as u128 + 1),
                stage: CompactionHookStage::PreCompact,
                hooks: Arc::new(PhaseHook(phase)),
            })
            .collect(),
        observer.clone(),
    )
    .unwrap();
    let mut req = request(CompactionHookStage::PreCompact);
    for (phase, id) in [(CompactionPhase::Manual, 1), (CompactionPhase::MidTurn, 2)] {
        req.phase = phase;
        let selected = hooks.handler_ids_for(&req);
        assert_eq!(selected, vec![Uuid::from_u128(id)]);
        observer.0.lock().unwrap().clear();
        assert_eq!(
            hooks.run(req.clone()).await,
            CompactionHookOutcome::Continue
        );
        let events = observer.0.lock().unwrap();
        assert_eq!(events.len(), 2);
        assert!(
            events
                .iter()
                .all(|(event_id, _)| selected.contains(event_id))
        );
    }
}
impl CompactionHooks for Hook {
    fn notify(&self, _: &CompactionHookRequest, _: CompactionHookNotification) {}
    fn run(&self, _: CompactionHookRequest) -> CompactionHookFuture<'_> {
        unreachable!()
    }
    fn run_with_context(&self, _: CompactionHookRequest) -> CompactionHookResultFuture<'_> {
        Box::pin(async {
            self.barrier.wait().await;
            if self.wait {
                self.gate.notified().await;
            } else {
                self.gate.notify_one();
            }
            self.result.clone()
        })
    }
}

fn request(stage: CompactionHookStage) -> CompactionHookRequest {
    CompactionHookRequest {
        operation_id: Uuid::from_u128(1),
        conversation_id: Uuid::from_u128(2),
        turn_id: Uuid::from_u128(3),
        phase: CompactionPhase::Manual,
        stage,
        model: ModelIdentity {
            provider_id: "test".into(),
            model_id: "model".into(),
            revision: None,
        },
    }
}

fn handler(
    id: u128,
    result: CompactionHookResult,
    barrier: &Arc<Barrier>,
    gate: &Arc<Notify>,
    wait: bool,
) -> CompactionHookHandler {
    CompactionHookHandler {
        id: Uuid::from_u128(id),
        stage: CompactionHookStage::SessionStartCompact,
        hooks: Arc::new(Hook {
            result,
            barrier: barrier.clone(),
            gate: gate.clone(),
            wait,
        }),
    }
}

#[tokio::test]
async fn concurrent_completion_preserves_configuration_order_and_any_stop() {
    let observer = Arc::new(Observer::default());
    let collector = Arc::new(Observer::default());
    let barrier = Arc::new(Barrier::new(2));
    let gate = Arc::new(Notify::new());
    let hooks = ConcurrentCompactionHooks::new(
        vec![
            handler(
                10,
                CompactionHookResult {
                    outcome: CompactionHookOutcome::Stop,
                    additional_contexts: vec!["first".into()],
                },
                &barrier,
                &gate,
                true,
            ),
            handler(
                11,
                CompactionHookResult {
                    outcome: CompactionHookOutcome::Continue,
                    additional_contexts: vec!["second".into()],
                },
                &barrier,
                &gate,
                false,
            ),
        ],
        observer.clone(),
    )
    .unwrap();
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(1),
        hooks.run_with_handler_observer(
            request(CompactionHookStage::SessionStartCompact),
            collector.clone(),
        ),
    )
    .await
    .unwrap();
    assert_eq!(result.outcome, CompactionHookOutcome::Stop);
    assert_eq!(result.additional_contexts, ["first", "second"]);
    let events = observer.0.lock().unwrap();
    let completed: Vec<_> = events
        .iter()
        .filter(|(_, event)| matches!(event, CompactionHookNotification::Completed(_)))
        .map(|(id, _)| *id)
        .collect();
    assert_eq!(completed, [Uuid::from_u128(11), Uuid::from_u128(10)]);
    assert_eq!(*collector.0.lock().unwrap(), *events);
    assert_eq!(
        hooks.handler_ids(CompactionHookStage::SessionStartCompact),
        [Uuid::from_u128(10), Uuid::from_u128(11)]
    );
    assert!(
        hooks
            .handler_ids(CompactionHookStage::PreCompact)
            .is_empty()
    );
}

#[tokio::test]
async fn failed_handler_context_is_discarded_without_losing_successful_context() {
    let observer = Arc::new(Observer::default());
    let barrier = Arc::new(Barrier::new(2));
    let gate = Arc::new(Notify::new());
    let hooks = ConcurrentCompactionHooks::new(
        vec![
            handler(
                10,
                CompactionHookResult {
                    outcome: CompactionHookOutcome::Failed,
                    additional_contexts: vec!["untrusted failed output".into()],
                },
                &barrier,
                &gate,
                true,
            ),
            handler(
                11,
                CompactionHookResult {
                    outcome: CompactionHookOutcome::Continue,
                    additional_contexts: vec!["kept".into()],
                },
                &barrier,
                &gate,
                false,
            ),
        ],
        observer.clone(),
    )
    .unwrap();
    let result = hooks
        .run_with_context(request(CompactionHookStage::SessionStartCompact))
        .await;
    assert_eq!(result.outcome, CompactionHookOutcome::Continue);
    assert_eq!(result.additional_contexts, ["kept"]);
    assert!(observer.0.lock().unwrap().contains(&(
        Uuid::from_u128(10),
        CompactionHookNotification::Completed(CompactionHookOutcome::Failed)
    )));
}

#[tokio::test]
async fn canceled_invocation_drops_all_started_handlers() {
    let observer = Arc::new(Observer::default());
    let barrier = Arc::new(Barrier::new(3));
    let gate = Arc::new(Notify::new());
    let hooks = ConcurrentCompactionHooks::new(
        vec![
            handler(
                10,
                CompactionHookResult::without_context(CompactionHookOutcome::Continue),
                &barrier,
                &gate,
                true,
            ),
            handler(
                11,
                CompactionHookResult::without_context(CompactionHookOutcome::Continue),
                &barrier,
                &gate,
                true,
            ),
        ],
        observer.clone(),
    )
    .unwrap();
    let mut running = hooks.run_with_context(request(CompactionHookStage::SessionStartCompact));
    tokio::select! {
        _ = &mut running => panic!("both handlers should remain blocked"),
        _ = barrier.wait() => {},
    }
    drop(running);
    let events = observer.0.lock().unwrap();
    for id in [10, 11] {
        assert_eq!(
            events
                .iter()
                .filter(|(actual, event)| *actual == Uuid::from_u128(id)
                    && *event == CompactionHookNotification::Started)
                .count(),
            1
        );
        assert_eq!(
            events
                .iter()
                .filter(|(actual, event)| *actual == Uuid::from_u128(id)
                    && *event
                        == CompactionHookNotification::Completed(CompactionHookOutcome::Canceled))
                .count(),
            1
        );
    }
}

#[test]
fn duplicate_and_nil_handler_identities_are_rejected() {
    let observer = Arc::new(Observer::default());
    let barrier = Arc::new(Barrier::new(1));
    let gate = Arc::new(Notify::new());
    for ids in [vec![0], vec![10, 10]] {
        let handlers = ids
            .into_iter()
            .map(|id| {
                handler(
                    id,
                    CompactionHookResult::without_context(CompactionHookOutcome::Continue),
                    &barrier,
                    &gate,
                    false,
                )
            })
            .collect();
        assert!(ConcurrentCompactionHooks::new(handlers, observer.clone()).is_err());
    }
}

#[tokio::test]
async fn other_stages_do_not_dispatch_session_start_handlers() {
    let observer = Arc::new(Observer::default());
    let hooks = ConcurrentCompactionHooks::new(
        vec![handler(
            10,
            CompactionHookResult::without_context(CompactionHookOutcome::Stop),
            &Arc::new(Barrier::new(2)),
            &Arc::new(Notify::new()),
            true,
        )],
        observer.clone(),
    )
    .unwrap();
    let result = hooks
        .run_with_context(request(CompactionHookStage::PreCompact))
        .await;
    assert_eq!(result.outcome, CompactionHookOutcome::Continue);
    assert!(observer.0.lock().unwrap().is_empty());
}
