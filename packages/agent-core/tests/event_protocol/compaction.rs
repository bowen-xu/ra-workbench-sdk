use super::*;

#[test]
fn standalone_compaction_completion_is_distinct_from_stream_completion() {
    let mut state = ConversationProjection::new(ConversationId::from_uuid(id(1)));
    state.apply(&started()).unwrap();
    state
        .apply(&event(
            2,
            EventPayload::PhaseChanged {
                turn_id: id(2),
                phase: TurnPhase::RunningModel,
            },
        ))
        .unwrap();
    state
        .apply(&event(
            3,
            EventPayload::ModelRequestStarted {
                turn_id: id(2),
                attempt_id: id(50),
                model: ModelIdentity {
                    provider_id: "test".into(),
                    model_id: "test".into(),
                    revision: None,
                },
            },
        ))
        .unwrap();
    assert!(
        state
            .apply(&event(
                4,
                EventPayload::ModelRequestFinished {
                    turn_id: id(2),
                    attempt_id: id(50),
                    input_tokens: Some(9),
                    output_tokens: Some(2),
                }
            ))
            .is_err()
    );
    state
        .apply(&event(
            4,
            EventPayload::ModelCompactionFinished {
                turn_id: id(2),
                attempt_id: id(50),
                input_tokens: Some(9),
                output_tokens: Some(2),
            },
        ))
        .unwrap();
    let attempt = &state.turn(id(2)).unwrap().attempts[&id(50)];
    assert!(attempt.response_id.is_none());
    assert_eq!(attempt.outcome, Some(TurnOutcome::Completed));
    assert_eq!(attempt.input_tokens, Some(9));
}

#[test]
fn context_compaction_lifecycle_has_no_model_attempt_or_text() {
    let mut state = ConversationProjection::new(ConversationId::from_uuid(id(1)));
    state.apply(&started()).unwrap();
    let start = event(
        2,
        EventPayload::ItemStarted {
            turn_id: id(2),
            item_id: id(60),
            kind: ItemKind::ContextCompaction,
        },
    );
    let wire = serde_json::to_value(&start).unwrap();
    assert_eq!(wire["payload"]["kind"]["type"], "contextCompaction");
    let restored = serde_json::from_value(wire).unwrap();
    state.apply(&restored).unwrap();
    assert!(
        state
            .apply(&event(
                3,
                EventPayload::TextDelta {
                    turn_id: id(2),
                    item_id: id(60),
                    text: "not a summary".into(),
                }
            ))
            .is_err()
    );
    assert!(
        state
            .apply(&event(
                3,
                EventPayload::TurnFinished {
                    turn_id: id(2),
                    outcome: TurnOutcome::Completed,
                }
            ))
            .is_err()
    );
    state
        .apply(&event(
            3,
            EventPayload::ItemCompleted {
                turn_id: id(2),
                item_id: id(60),
            },
        ))
        .unwrap();
    state
        .apply(&event(
            4,
            EventPayload::TurnFinished {
                turn_id: id(2),
                outcome: TurnOutcome::Completed,
            },
        ))
        .unwrap();
    let turn = state.turn(id(2)).unwrap();
    assert!(turn.attempts.is_empty());
    assert_eq!(turn.input_tokens, None);
    assert_eq!(turn.output_tokens, None);
    assert!(turn.items[&id(60)].completed);
    let exported = research_agent_core::conversation::ConversationExport::from_projection(
        research_agent_core::conversation::ConversationSummary {
            internal: false,
            id: state.conversation_id(),
            title: "fixture".into(),
            archived: false,
            durable_count: state.seq(),
            created_at: "time".into(),
            updated_at: "time".into(),
        },
        &state,
    )
    .unwrap();
    assert_eq!(
        serde_json::to_value(exported).unwrap()["turns"][0]["items"][0]["kind"]["type"],
        "contextCompaction"
    );
}

#[test]
fn unfinished_context_compaction_is_interrupted_when_turn_cancels() {
    let mut state = ConversationProjection::new(ConversationId::from_uuid(id(1)));
    state.apply(&started()).unwrap();
    state
        .apply(&event(
            2,
            EventPayload::ItemStarted {
                turn_id: id(2),
                item_id: id(60),
                kind: ItemKind::ContextCompaction,
            },
        ))
        .unwrap();
    state
        .apply(&event(
            3,
            EventPayload::TurnFinished {
                turn_id: id(2),
                outcome: TurnOutcome::Canceled,
            },
        ))
        .unwrap();
    let item = &state.turn(id(2)).unwrap().items[&id(60)];
    assert!(!item.completed);
    assert!(item.interrupted);
    assert!(
        state
            .apply(&event(
                4,
                EventPayload::ItemCompleted {
                    turn_id: id(2),
                    item_id: id(60),
                }
            ))
            .is_err()
    );
}
