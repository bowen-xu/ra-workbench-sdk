use research_agent_core::{conversation::ConversationId, protocol::*};
use uuid::Uuid;

fn id(value: u128) -> Uuid {
    Uuid::from_u128(value)
}
fn event(seq: u64, payload: EventPayload) -> AgentEvent {
    AgentEvent::new(ConversationId::from_uuid(id(1)), seq, 0, id(4), payload).unwrap()
}
fn started() -> AgentEvent {
    event(
        1,
        EventPayload::TurnStarted {
            task_kind: research_agent_core::protocol::TaskKind::Regular,
            turn_id: id(2),
            context_snapshot_id: id(3),
            model: ModelIdentity {
                provider_id: "test".into(),
                model_id: "test".into(),
                revision: None,
            },
        },
    )
}

#[path = "event_protocol/acceptance.rs"]
mod acceptance;
#[path = "event_protocol/compaction.rs"]
mod compaction;
#[path = "event_protocol/output_order.rs"]
mod output_order;

#[test]
fn hook_prompt_is_an_atomic_sourced_input_not_a_streamed_item() {
    let fragment = HookPromptFragment {
        run_id: id(21),
        input_text: "<hook_prompt>retry</hook_prompt>".into(),
    };
    let kind = ItemKind::HookPrompt {
        invocation_id: id(20),
        fragments: vec![fragment.clone()],
    };
    let accepted = EventPayload::ItemAccepted {
        turn_id: id(2),
        item_id: id(10),
        kind: kind.clone(),
        text: String::new(),
        phase: None,
        source: None,
    };
    let saved = event(2, accepted.clone());
    let decoded: AgentEvent =
        serde_json::from_value(serde_json::to_value(&saved).unwrap()).unwrap();
    assert_eq!(decoded, saved);
    let mut projection = ConversationProjection::new(ConversationId::from_uuid(id(1)));
    projection.apply(&started()).unwrap();
    projection.apply(&decoded).unwrap();
    assert!(projection.turn(id(2)).unwrap().items[&id(10)].completed);
    let exported = research_agent_core::conversation::ConversationExport::from_projection(
        research_agent_core::conversation::ConversationSummary {
            internal: false,
            id: projection.conversation_id(),
            title: "fixture".into(),
            archived: false,
            durable_count: projection.seq(),
            created_at: "time".into(),
            updated_at: "time".into(),
        },
        &projection,
    )
    .unwrap();
    let value = serde_json::to_value(exported).unwrap();
    assert_eq!(
        value["turns"][0]["items"][0]["kind"],
        serde_json::to_value(&kind).unwrap()
    );
    assert!(
        AgentEvent::new(
            ConversationId::from_uuid(id(1)),
            2,
            0,
            id(4),
            EventPayload::ItemStarted {
                turn_id: id(2),
                item_id: id(10),
                kind,
            }
        )
        .is_err()
    );
    let invalid = EventPayload::ItemAccepted {
        turn_id: id(2),
        item_id: id(11),
        kind: ItemKind::HookPrompt {
            invocation_id: id(20),
            fragments: vec![fragment.clone(), fragment],
        },
        text: String::new(),
        phase: None,
        source: None,
    };
    assert!(AgentEvent::new(ConversationId::from_uuid(id(1)), 2, 0, id(4), invalid).is_err());
}

#[test]
fn child_creation_intent_requires_the_original_accepted_call_and_survives_replay() {
    use research_agent_core::conversation::{BindingKind, ConversationBinding};
    let mut projection = ConversationProjection::new(ConversationId::from_uuid(id(1)));
    projection.apply(&started()).unwrap();
    let prepared = EventPayload::ChildCreationPrepared {
        turn_id: id(2),
        call_id: id(20),
        version: 1,
        child_id: id(30),
        operation_id: id(31),
        submission_request_id: None,
        binding: ConversationBinding {
            kind: BindingKind::Paper,
            resource_id: " paper ".into(),
        },
    };
    assert!(projection.apply(&event(2, prepared.clone())).is_err());
    let call = EventPayload::ItemAccepted {
        turn_id: id(2),
        item_id: id(10),
        kind: ItemKind::ToolCall {
            call_id: id(20),
            name: "research_spawn_subtask".into(),
            provider_call_id: Some("original-call".into()),
            namespace: None,
        },
        text: "{}".into(),
        phase: None,
        source: None,
    };
    projection.apply(&event(2, call)).unwrap();
    let saved = event(3, prepared.clone());
    let mut invalid = serde_json::to_value(&saved).unwrap();
    invalid["payload"]["version"] = serde_json::json!(2);
    assert!(serde_json::from_value::<AgentEvent>(invalid).is_err());
    let roundtrip: AgentEvent =
        serde_json::from_value(serde_json::to_value(&saved).unwrap()).unwrap();
    projection.apply(&roundtrip).unwrap();
    let intent = &projection.turn(id(2)).unwrap().child_creation_intents[&id(20)];
    assert_eq!(intent.id, ConversationId::from_uuid(id(30)));
    assert_eq!(intent.operation_id, id(31));
    assert_eq!(intent.binding.resource_id, " paper ");
    assert!(
        projection
            .turn(id(2))
            .unwrap()
            .child_submission_requests
            .is_empty()
    );
    assert!(projection.apply(&event(4, prepared)).is_err());
    assert_eq!(projection.seq(), 3);
}

#[test]
fn child_creation_v2_requires_and_replays_the_frozen_submission_identity() {
    use research_agent_core::conversation::{
        BindingKind, ConversationBinding, child_submission_request_id,
    };
    let child = id(30);
    let request = child_submission_request_id(child);
    let payload = EventPayload::ChildCreationPrepared {
        turn_id: id(2),
        call_id: id(20),
        version: 2,
        child_id: child,
        operation_id: id(31),
        binding: ConversationBinding {
            kind: BindingKind::Paper,
            resource_id: "paper".into(),
        },
        submission_request_id: Some(request),
    };
    let saved = event(3, payload);
    let value = serde_json::to_value(&saved).unwrap();
    assert_eq!(value["payload"]["submissionRequestId"], request.to_string());
    for invalid_request in [serde_json::Value::Null, serde_json::json!(id(99))] {
        let mut invalid = value.clone();
        invalid["payload"]["submissionRequestId"] = invalid_request;
        assert!(serde_json::from_value::<AgentEvent>(invalid).is_err());
    }
    let mut projection = ConversationProjection::new(ConversationId::from_uuid(id(1)));
    projection.apply(&started()).unwrap();
    projection
        .apply(&event(
            2,
            EventPayload::ItemAccepted {
                turn_id: id(2),
                item_id: id(10),
                kind: ItemKind::ToolCall {
                    call_id: id(20),
                    name: "research_spawn_subtask".into(),
                    provider_call_id: Some("original-call".into()),
                    namespace: None,
                },
                text: "{}".into(),
                phase: None,
                source: None,
            },
        ))
        .unwrap();
    projection
        .apply(&serde_json::from_value::<AgentEvent>(value).unwrap())
        .unwrap();
    assert_eq!(
        projection
            .turn(id(2))
            .unwrap()
            .child_submission_requests
            .get(&id(20)),
        Some(&request)
    );
}

#[test]
fn shared_child_creation_fixture_round_trips() {
    for fixture in [
        include_str!("../../../tests/fixtures/agent-child-creation-v1.json"),
        include_str!("../../../tests/fixtures/agent-child-creation-v2.json"),
    ] {
        let value: serde_json::Value = serde_json::from_str(fixture).unwrap();
        let event: AgentEvent = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(serde_json::to_value(event).unwrap(), value);
    }
}

#[test]
fn failed_model_attempt_is_durable_and_allows_a_safe_retry_attempt() {
    let mut state = ConversationProjection::new(ConversationId::from_uuid(id(1)));
    assert_eq!(state.apply(&started()), Ok(ApplyResult::Applied));
    let model = ModelIdentity {
        provider_id: "test".into(),
        model_id: "test".into(),
        revision: None,
    };
    for (seq, payload) in [
        (
            2,
            EventPayload::PhaseChanged {
                turn_id: id(2),
                phase: TurnPhase::RunningModel,
            },
        ),
        (
            3,
            EventPayload::ModelRequestStarted {
                turn_id: id(2),
                attempt_id: id(50),
                model: model.clone(),
            },
        ),
        (
            4,
            EventPayload::ModelRequestFailed {
                turn_id: id(2),
                attempt_id: id(50),
                error: "temporarily unavailable".into(),
                retryable: true,
                category: Some(FailureCategory::ProviderTemporaryUnavailable),
            },
        ),
        (
            5,
            EventPayload::ModelRequestStarted {
                turn_id: id(2),
                attempt_id: id(51),
                model,
            },
        ),
    ] {
        assert_eq!(state.apply(&event(seq, payload)), Ok(ApplyResult::Applied));
    }
    assert_eq!(
        state.turn(id(2)).unwrap().attempts[&id(50)].outcome,
        Some(TurnOutcome::Failed)
    );
}

#[test]
fn shared_fixture_round_trips_and_replays_without_duplicate_text() {
    let value: serde_json::Value =
        serde_json::from_str(include_str!("../../../tests/fixtures/agent-events-v1.json")).unwrap();
    let events: Vec<AgentEvent> = serde_json::from_value(value.clone()).unwrap();
    assert_eq!(serde_json::to_value(&events).unwrap(), value);
    let mut state = ConversationProjection::new(ConversationId::from_uuid(id(1)));
    for event in &events {
        assert_eq!(state.apply(event), Ok(ApplyResult::Applied));
        assert_eq!(state.apply(event), Ok(ApplyResult::AlreadyApplied));
    }
    assert_eq!(state.seq(), events.last().unwrap().seq());
    assert_eq!(state.active_turn(), None);
    let turn = state.turn(id(2)).unwrap();
    assert_eq!(turn.outcome, Some(TurnOutcome::Completed));
    assert_eq!(turn.items[&id(13)].text, "检查完成。");
    assert_eq!(
        turn.items[&id(13)].native_phase,
        Some(AssistantMessagePhase::FinalAnswer)
    );
    assert_eq!(turn.item_order, [id(10), id(11), id(12), id(13)]);
    assert_eq!(
        turn.attempts[&id(50)]
            .actual_model
            .as_ref()
            .unwrap()
            .model_id,
        "agent-test-actual"
    );
    assert_eq!(turn.attempts[&id(50)].input_tokens, Some(5));
    let failed = state.turn(id(60)).unwrap();
    assert_eq!(failed.outcome, Some(TurnOutcome::Failed));
    assert_eq!(
        failed.failure,
        Some(("run budget exhausted".into(), FailureCategory::Admission))
    );
}

#[test]
fn wire_rejects_future_schema_invalid_numbers_unknown_fields_and_empty_delta() {
    let initial = serde_json::to_value(started()).unwrap();
    for (field, value) in [
        ("schemaVersion", serde_json::json!(2)),
        ("seq", serde_json::json!(0)),
        ("seq", serde_json::json!(9_007_199_254_740_992_u64)),
        ("timestampMs", serde_json::json!(-1)),
        ("secret", serde_json::json!("not an allowed field")),
    ] {
        let mut invalid = initial.clone();
        invalid[field] = value;
        assert!(
            serde_json::from_value::<AgentEvent>(invalid).is_err(),
            "{field}"
        );
    }
    assert!(
        AgentEvent::new(
            ConversationId::from_uuid(id(1)),
            1,
            0,
            id(4),
            EventPayload::TextDelta {
                turn_id: id(2),
                item_id: id(10),
                text: String::new()
            }
        )
        .is_err()
    );
}

#[test]
fn failed_model_attempt_error_is_bounded() {
    let oversized = AgentEvent::new(
        ConversationId::from_uuid(id(1)),
        1,
        0,
        id(4),
        EventPayload::ModelRequestFailed {
            turn_id: id(2),
            attempt_id: id(50),
            error: "x".repeat(1_025),
            retryable: true,
            category: Some(FailureCategory::Provider),
        },
    );
    assert!(oversized.is_err());
    let control = AgentEvent::new(
        ConversationId::from_uuid(id(1)),
        1,
        0,
        id(4),
        EventPayload::ModelRequestFailed {
            turn_id: id(2),
            attempt_id: id(50),
            error: "provider\u{0000}error".into(),
            retryable: false,
            category: Some(FailureCategory::Provider),
        },
    );
    assert!(control.is_err());
}

#[test]
fn gaps_and_bad_transitions_leave_projection_unchanged() {
    let mut state = ConversationProjection::new(ConversationId::from_uuid(id(1)));
    state.apply(&started()).unwrap();
    let before = state.clone();
    assert!(matches!(
        state.apply(&event(
            3,
            EventPayload::PhaseChanged {
                turn_id: id(2),
                phase: TurnPhase::RunningModel
            }
        )),
        Err(ProjectionError::Gap { .. })
    ));
    assert!(
        state
            .apply(&event(
                2,
                EventPayload::TextDelta {
                    turn_id: id(2),
                    item_id: id(99),
                    text: "late".into()
                }
            ))
            .is_err()
    );
    assert!(
        state
            .apply(&event(
                2,
                EventPayload::PhaseChanged {
                    turn_id: id(2),
                    phase: TurnPhase::RunningTools
                }
            ))
            .is_err()
    );
    assert_eq!(state, before);
}

#[test]
fn canceled_turn_keeps_partial_text_and_rejects_late_output() {
    let mut state = ConversationProjection::new(ConversationId::from_uuid(id(1)));
    for event in [
        started(),
        event(
            2,
            EventPayload::ItemStarted {
                turn_id: id(2),
                item_id: id(10),
                kind: ItemKind::AssistantMessage,
            },
        ),
        event(
            3,
            EventPayload::TextDelta {
                turn_id: id(2),
                item_id: id(10),
                text: "partial".into(),
            },
        ),
        event(
            4,
            EventPayload::TurnFinished {
                turn_id: id(2),
                outcome: TurnOutcome::Canceled,
            },
        ),
    ] {
        state.apply(&event).unwrap();
    }
    let before = state.clone();
    assert!(state.turn(id(2)).unwrap().items[&id(10)].interrupted);
    assert!(
        state
            .apply(&event(
                5,
                EventPayload::TextDelta {
                    turn_id: id(2),
                    item_id: id(10),
                    text: "late".into()
                }
            ))
            .is_err()
    );
    assert!(
        state
            .apply(&event(
                5,
                EventPayload::TurnFinished {
                    turn_id: id(2),
                    outcome: TurnOutcome::Completed
                }
            ))
            .is_err()
    );
    assert_eq!(state, before);
}

#[test]
fn assistant_text_items_keep_independent_ids_and_phases_within_one_turn() {
    let mut state = ConversationProjection::new(ConversationId::from_uuid(id(1)));
    for (seq, payload) in [
        (
            1,
            EventPayload::TurnStarted {
                task_kind: research_agent_core::protocol::TaskKind::Regular,
                turn_id: id(2),
                context_snapshot_id: id(3),
                model: ModelIdentity {
                    provider_id: "test".into(),
                    model_id: "test".into(),
                    revision: None,
                },
            },
        ),
        (
            2,
            EventPayload::ItemStarted {
                turn_id: id(2),
                item_id: id(10),
                kind: ItemKind::AssistantMessage,
            },
        ),
        (
            3,
            EventPayload::TextDelta {
                turn_id: id(2),
                item_id: id(10),
                text: "进展".into(),
            },
        ),
        (
            4,
            EventPayload::ItemPhaseChanged {
                turn_id: id(2),
                item_id: id(10),
                phase: AssistantMessagePhase::Commentary,
                native: false,
            },
        ),
        (
            5,
            EventPayload::ItemCompleted {
                turn_id: id(2),
                item_id: id(10),
            },
        ),
        (
            6,
            EventPayload::ItemStarted {
                turn_id: id(2),
                item_id: id(11),
                kind: ItemKind::AssistantMessage,
            },
        ),
        (
            7,
            EventPayload::TextDelta {
                turn_id: id(2),
                item_id: id(11),
                text: "结论".into(),
            },
        ),
        (
            8,
            EventPayload::ItemPhaseChanged {
                turn_id: id(2),
                item_id: id(11),
                phase: AssistantMessagePhase::FinalAnswer,
                native: false,
            },
        ),
        (
            9,
            EventPayload::ItemCompleted {
                turn_id: id(2),
                item_id: id(11),
            },
        ),
        (
            10,
            EventPayload::TurnFinished {
                turn_id: id(2),
                outcome: TurnOutcome::Completed,
            },
        ),
    ] {
        state.apply(&event(seq, payload)).unwrap();
    }
    let turn = state.turn(id(2)).unwrap();
    assert_eq!(turn.item_order, [id(10), id(11)]);
    assert_eq!(turn.items[&id(10)].text, "进展");
    assert_eq!(
        turn.items[&id(10)].phase,
        Some(AssistantMessagePhase::Commentary)
    );
    assert_eq!(turn.items[&id(11)].text, "结论");
    assert_eq!(
        turn.items[&id(11)].phase,
        Some(AssistantMessagePhase::FinalAnswer)
    );
}

#[test]
fn orphan_tool_result_and_unfinished_success_are_rejected() {
    let mut state = ConversationProjection::new(ConversationId::from_uuid(id(1)));
    state.apply(&started()).unwrap();
    assert!(
        state
            .apply(&event(
                2,
                EventPayload::ItemStarted {
                    turn_id: id(2),
                    item_id: id(10),
                    kind: ItemKind::ToolResult {
                        call_id: id(5),
                        is_error: None
                    }
                }
            ))
            .is_err()
    );
    state
        .apply(&event(
            2,
            EventPayload::ItemStarted {
                turn_id: id(2),
                item_id: id(10),
                kind: ItemKind::AssistantMessage,
            },
        ))
        .unwrap();
    assert!(
        state
            .apply(&event(
                3,
                EventPayload::TurnFinished {
                    turn_id: id(2),
                    outcome: TurnOutcome::Completed
                }
            ))
            .is_err()
    );
    assert_eq!(state.seq(), 2);
}

#[test]
fn unknown_cumulative_usage_does_not_display_a_previous_partial_total() {
    let mut state = ConversationProjection::new(ConversationId::from_uuid(id(1)));
    state.apply(&started()).unwrap();
    state
        .apply(&event(
            2,
            EventPayload::Usage {
                turn_id: id(2),
                input_tokens: Some(10),
                output_tokens: Some(5),
            },
        ))
        .unwrap();
    state
        .apply(&event(
            3,
            EventPayload::Usage {
                turn_id: id(2),
                input_tokens: None,
                output_tokens: None,
            },
        ))
        .unwrap();
    assert_eq!(state.turn(id(2)).unwrap().input_tokens, None);
    assert_eq!(state.turn(id(2)).unwrap().output_tokens, None);
}

#[test]
fn legacy_tool_metadata_stays_unknown_and_new_metadata_round_trips() {
    let legacy = serde_json::json!({"type":"toolResult","callId":id(8)});
    let decoded: ItemKind = serde_json::from_value(legacy.clone()).unwrap();
    assert!(matches!(
        decoded,
        ItemKind::ToolResult { is_error: None, .. }
    ));
    assert_eq!(serde_json::to_value(decoded).unwrap(), legacy);
    let failed = ItemKind::ToolResult {
        call_id: id(8),
        is_error: Some(true),
    };
    let json = serde_json::to_value(&failed).unwrap();
    assert_eq!(json["isError"], true);
    assert_eq!(serde_json::from_value::<ItemKind>(json).unwrap(), failed);
    let legacy_call: ItemKind = serde_json::from_value(serde_json::json!({
        "type":"toolCall","callId":id(8),"name":"read"
    }))
    .unwrap();
    assert!(matches!(
        legacy_call,
        ItemKind::ToolCall {
            provider_call_id: None,
            namespace: None,
            ..
        }
    ));
}

#[test]
fn replay_rejects_reused_provider_call_identity_without_changing_state() {
    let mut projection = ConversationProjection::new(ConversationId::from_uuid(id(1)));
    projection.apply(&started()).unwrap();
    let call = |item, call_id| EventPayload::ItemStarted {
        turn_id: id(2),
        item_id: id(item),
        kind: ItemKind::ToolCall {
            call_id: id(call_id),
            name: "read".into(),
            provider_call_id: Some("provider-call".into()),
            namespace: None,
        },
    };
    projection.apply(&event(2, call(10, 20))).unwrap();
    let before = projection.clone();
    assert!(projection.apply(&event(3, call(11, 21))).is_err());
    assert_eq!(projection, before);
}

#[test]
fn unfinished_model_attempt_is_recovered_as_interrupted_without_inventing_response() {
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
    let model = state.turn(id(2)).unwrap().model.clone();
    state
        .apply(&event(
            3,
            EventPayload::ModelRequestStarted {
                turn_id: id(2),
                attempt_id: id(80),
                model,
            },
        ))
        .unwrap();
    let before = state.clone();
    assert!(
        state
            .apply(&event(
                4,
                EventPayload::TurnFinished {
                    turn_id: id(2),
                    outcome: TurnOutcome::Completed
                }
            ))
            .is_err()
    );
    assert_eq!(before, state);
    state
        .apply(&event(
            4,
            EventPayload::TurnFinished {
                turn_id: id(2),
                outcome: TurnOutcome::Interrupted,
            },
        ))
        .unwrap();
    let attempt = &state.turn(id(2)).unwrap().attempts[&id(80)];
    assert_eq!(attempt.outcome, Some(TurnOutcome::Interrupted));
    assert_eq!(attempt.actual_model, None);
    assert_eq!(attempt.input_tokens, None);
}

#[test]
fn legacy_regular_and_explicit_compact_task_kinds_replay_consistently() {
    let legacy = serde_json::to_value(started()).unwrap();
    assert!(legacy["payload"].get("taskKind").is_none());
    let mut compact = legacy.clone();
    compact["payload"]["taskKind"] = serde_json::json!("compact");
    for (wire, expected) in [(legacy, TaskKind::Regular), (compact, TaskKind::Compact)] {
        let decoded: AgentEvent = serde_json::from_value(wire.clone()).unwrap();
        assert_eq!(serde_json::to_value(&decoded).unwrap(), wire);
        let mut projection = ConversationProjection::new(ConversationId::from_uuid(id(1)));
        projection.apply(&decoded).unwrap();
        assert_eq!(projection.turn(id(2)).unwrap().task_kind, expected);
    }
}
