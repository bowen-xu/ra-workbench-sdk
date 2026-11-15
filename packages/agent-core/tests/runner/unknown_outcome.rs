use super::*;
use research_agent_core::conversation::{CatalogError, completed_fork_boundary};
use std::sync::atomic::AtomicBool;
use tokio::sync::Notify;

#[tokio::test]
async fn oversized_result_keeps_full_history_and_delivers_bounded_model_view() {
    struct LargeOutput<'a> {
        calls: AtomicUsize,
        receipts: AtomicUsize,
        text: String,
        sink: &'a Sink,
    }
    impl ToolExecutor for LargeOutput<'_> {
        fn validate(&self, _: &ToolCall) -> Result<(), RunError> {
            Ok(())
        }
        fn authorize_and_execute(&self, _: ToolCall) -> RunFuture<'_, ToolOutput> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            let content = self.text.clone();
            Box::pin(async move {
                Ok(ToolOutput {
                    content,
                    is_error: false,
                })
            })
        }
        fn result_committed(&self, _: ToolCall) -> RunFuture<'_, ()> {
            let projection = self.sink.projection.lock().unwrap();
            assert!(
                projection
                    .turn(Uuid::from_u128(2))
                    .unwrap()
                    .items
                    .values()
                    .any(|item| item.completed
                        && matches!(item.kind, ItemKind::ToolResult { .. })
                        && item.text == self.text)
            );
            self.receipts.fetch_add(1, Ordering::SeqCst);
            Box::pin(async { Ok(()) })
        }
    }
    let (transport, sink, ids, request) = setup(vec![tool_response(), answer()]);
    let tools = LargeOutput {
        calls: AtomicUsize::new(0),
        receipts: AtomicUsize::new(0),
        text: "😀abcXYZ".repeat(30),
        sink: &sink,
    };
    let mut bounded = limits();
    bounded.tool_output_bytes = 64;
    TurnRunner {
        transport: &transport,
        tools: &tools,
        sink: &sink,
        ids: &ids,
        limits: bounded,
    }
    .run(Uuid::from_u128(2), request)
    .await
    .unwrap();
    assert_eq!(tools.calls.load(Ordering::SeqCst), 1);
    assert_eq!(tools.receipts.load(Ordering::SeqCst), 1);
    let requests = transport.requests.lock().unwrap();
    let view = requests[1]
        .messages
        .iter()
        .find_map(|message| match message {
            ModelMessage::ToolResult { content, .. } => Some(content.clone()),
            _ => None,
        })
        .unwrap();
    assert!(view.len() <= 64 && view.contains("chars truncated"));
    drop(requests);
    let history = sink.projection.lock().unwrap();
    let turn = history.turn(Uuid::from_u128(2)).unwrap();
    assert!(turn.items.values().any(|item| matches!(item.kind, ItemKind::ToolResult { .. }) && item.text == tools.text));
    assert!(!history.has_unknown_tool_outcome());
    let mut replay = reconstruct_history(&history).unwrap();
    assert!(research_agent_core::model::tool_output::bound_tool_results(
        &mut replay,
        64
    ));
    assert!(replay.iter().any(
        |message| matches!(message, ModelMessage::ToolResult { content, .. } if content == &view)
    ));
}

#[tokio::test]
async fn unrepresentable_model_view_preserves_known_result_and_receipt() {
    struct LargeOutput {
        calls: AtomicUsize,
        receipts: AtomicUsize,
    }
    impl ToolExecutor for LargeOutput {
        fn validate(&self, _: &ToolCall) -> Result<(), RunError> {
            Ok(())
        }
        fn authorize_and_execute(&self, _: ToolCall) -> RunFuture<'_, ToolOutput> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            Box::pin(async {
                Ok(ToolOutput {
                    content: "large output".into(),
                    is_error: false,
                })
            })
        }
        fn requires_result_receipt(&self, _: &ToolCall) -> bool {
            true
        }
        fn result_committed(&self, _: ToolCall) -> RunFuture<'_, ()> {
            self.receipts.fetch_add(1, Ordering::SeqCst);
            Box::pin(async { Ok(()) })
        }
    }
    let (transport, sink, ids, request) = setup(vec![tool_response(), answer()]);
    let tools = LargeOutput {
        calls: AtomicUsize::new(0),
        receipts: AtomicUsize::new(0),
    };
    let mut bounded = limits();
    bounded.tool_output_bytes = 5;
    let result = TurnRunner {
        transport: &transport,
        tools: &tools,
        sink: &sink,
        ids: &ids,
        limits: bounded,
    }
    .run(Uuid::from_u128(2), request)
    .await;
    assert!(matches!(result, Err(RunError::Budget)));
    assert_eq!(tools.calls.load(Ordering::SeqCst), 1);
    assert_eq!(tools.receipts.load(Ordering::SeqCst), 1);
    assert_eq!(transport.requests.lock().unwrap().len(), 1);
    let projection = sink.projection.lock().unwrap();
    assert!(!projection.has_unknown_tool_outcome());
    assert!(reconstruct_history(&projection).unwrap().iter().any(|message| {
        matches!(message, ModelMessage::ToolResult { content, .. } if content == "large output")
    }));
}

struct OwnerState {
    response_done: AtomicBool,
    changed: Notify,
    starts: Mutex<Vec<String>>,
}
struct UnknownOwner(Arc<OwnerState>);
impl ToolExecutor for UnknownOwner {
    fn validate(&self, _: &ToolCall) -> Result<(), RunError> {
        Ok(())
    }
    fn authorize_and_execute(&self, call: ToolCall) -> RunFuture<'_, ToolOutput> {
        Box::pin(async move {
            self.0.starts.lock().unwrap().push(call.call_id);
            while !self.0.response_done.load(Ordering::SeqCst) {
                self.0.changed.notified().await;
            }
            Err(RunError::ToolOutcomeUnknown)
        })
    }
    fn result_committed(&self, _: ToolCall) -> RunFuture<'_, ()> {
        panic!("unknown effect has no acknowledged result")
    }
}
struct Journal<'a> {
    sink: &'a Sink,
    owner: Arc<OwnerState>,
    events: Mutex<Vec<AgentEvent>>,
}
impl TurnEventSink for Journal<'_> {
    fn emit(&self, payload: EventPayload) -> RunFuture<'_, ()> {
        Box::pin(async move {
            let event = AgentEvent::new(
                ConversationId::from_uuid(Uuid::from_u128(1)),
                self.sink.projection.lock().unwrap().seq() + 1,
                0,
                Uuid::from_u128(4),
                payload.clone(),
            )
            .unwrap();
            self.sink.emit(payload.clone()).await?;
            self.events.lock().unwrap().push(event);
            if matches!(payload, EventPayload::ModelRequestFinished { .. }) {
                self.owner.response_done.store(true, Ordering::SeqCst);
                self.owner.changed.notify_one();
            }
            Ok(())
        })
    }
}
fn event(seq: u64, payload: EventPayload) -> AgentEvent {
    AgentEvent::new(
        ConversationId::from_uuid(Uuid::from_u128(1)),
        seq,
        0,
        Uuid::from_u128(4),
        payload,
    )
    .unwrap()
}
fn next_turn() -> EventPayload {
    EventPayload::TurnStarted {
        task_kind: TaskKind::Regular,
        turn_id: Uuid::from_u128(900),
        context_snapshot_id: Uuid::from_u128(901),
        model: model(),
    }
}
fn assert_barrier(history: &mut ConversationProjection, events: &[AgentEvent]) {
    assert!(history.has_unknown_tool_outcome());
    assert!(matches!(
        reconstruct_history(history),
        Err(HistoryError::ToolOutcomeUnknown)
    ));
    assert!(matches!(
        reconstruct_history_for_continuation(history, &Default::default()),
        Err(HistoryError::ToolOutcomeUnknown)
    ));
    assert!(matches!(
        reconstruct_history_after_checkpoint(
            history,
            &Default::default(),
            &Default::default(),
            history.seq()
        ),
        Err(HistoryError::ToolOutcomeUnknown)
    ));
    assert!(history.context_tail(history.seq()).is_err());
    let before = history.clone();
    assert!(
        history
            .apply(&event(history.seq() + 1, next_turn()))
            .is_err()
    );
    assert_eq!(*history, before);
    assert!(
        history
            .apply(&event(
                history.seq() + 1,
                EventPayload::ConversationRolledBack {
                    turn_id: Uuid::from_u128(2),
                    user_turns: 1,
                }
            ))
            .is_err()
    );
    assert_eq!(*history, before);
    assert_eq!(
        completed_fork_boundary(history.conversation_id(), Uuid::from_u128(2), events),
        Err(CatalogError::Busy)
    );
}

#[tokio::test]
async fn unknown_effect_holds_intents_blocks_dependent_work_and_survives_replay_and_crash() {
    let mut script = vec![begin()];
    script.extend(call("unknown-call", "{}"));
    script.extend(call("dependent-call", "{}"));
    script.push(ModelStreamEvent::Completed {
        reason: FinishReason::ToolCalls,
        end_turn: None,
    });
    let (transport, sink, ids, request) = setup(vec![script, answer()]);
    let state = Arc::new(OwnerState {
        response_done: AtomicBool::new(false),
        changed: Notify::new(),
        starts: Mutex::new(vec![]),
    });
    let journal = Journal {
        sink: &sink,
        owner: state.clone(),
        events: Mutex::new(vec![event(
            1,
            EventPayload::TurnStarted {
                task_kind: TaskKind::Regular,
                turn_id: Uuid::from_u128(2),
                context_snapshot_id: Uuid::from_u128(3),
                model: model(),
            },
        )]),
    };
    let user = Uuid::from_u128(90);
    for payload in [
        EventPayload::ItemStarted {
            turn_id: Uuid::from_u128(2),
            item_id: user,
            kind: ItemKind::UserMessage,
        },
        EventPayload::TextDelta {
            turn_id: Uuid::from_u128(2),
            item_id: user,
            text: "question".into(),
        },
        EventPayload::ItemCompleted {
            turn_id: Uuid::from_u128(2),
            item_id: user,
        },
    ] {
        journal.emit(payload).await.unwrap();
    }
    let tools = UnknownOwner(state.clone());
    let result = TurnRunner {
        transport: &transport,
        tools: &tools,
        sink: &journal,
        ids: &ids,
        limits: limits(),
    }
    .run(Uuid::from_u128(2), request)
    .await;
    assert!(matches!(result, Err(RunError::ToolOutcomeUnknown)));
    assert_eq!(*state.starts.lock().unwrap(), ["unknown-call"]);
    assert_eq!(transport.requests.lock().unwrap().len(), 1);
    let projection = sink.projection.lock().unwrap();
    let turn = projection.turn(Uuid::from_u128(2)).unwrap();
    assert_eq!(turn.failure.as_ref().unwrap().1, FailureCategory::Recovery);
    assert_eq!(turn.outcome, Some(TurnOutcome::Failed));
    assert_eq!(
        turn.items
            .values()
            .filter(|item| item.accepted
                && item.completed
                && matches!(item.kind, ItemKind::ToolCall { .. }))
            .count(),
        2
    );
    let unknown_call = turn
        .items
        .values()
        .find_map(|item| match &item.kind {
            ItemKind::ToolCall {
                call_id,
                provider_call_id: Some(id),
                ..
            } if id == "unknown-call" => Some(*call_id),
            _ => None,
        })
        .unwrap();
    assert!(!turn.items.values().any(
        |item| matches!(item.kind, ItemKind::ToolResult { call_id, .. } if call_id == unknown_call)
    ));
    assert!(turn.items.values().any(|item| item.completed
        && item.text.contains("tool_not_started")
        && matches!(item.kind, ItemKind::ToolResult { .. })));
    drop(projection);
    let events = journal.events.lock().unwrap();
    let mut replay = ConversationProjection::new(ConversationId::from_uuid(Uuid::from_u128(1)));
    for event in events.iter() {
        replay.apply(event).unwrap();
    }
    assert_barrier(&mut replay, &events);

    // Crash after the owner reported unknown, before TurnFailed can be durable.
    let mut prefix: Vec<_> = events
        .iter()
        .take_while(|event| !matches!(event.payload(), EventPayload::TurnFailed { .. }))
        .cloned()
        .collect();
    let mut crashed = ConversationProjection::new(replay.conversation_id());
    for event in &prefix {
        crashed.apply(event).unwrap();
    }
    assert!(
        !crashed.has_unknown_tool_outcome(),
        "active work is still owned until startup reconciliation"
    );
    let interrupted = event(
        crashed.seq() + 1,
        EventPayload::TurnFinished {
            turn_id: Uuid::from_u128(2),
            outcome: TurnOutcome::Interrupted,
        },
    );
    crashed.apply(&interrupted).unwrap();
    prefix.push(interrupted);
    assert_barrier(&mut crashed, &prefix);
}
