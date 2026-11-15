use super::*;

fn apply(state: &mut ConversationProjection, payload: EventPayload) {
    state.apply(&event(state.seq() + 1, payload)).unwrap();
}
fn sampling() -> ConversationProjection {
    sampling_with_ordering(false)
}
fn sampling_with_ordering(interleaved: bool) -> ConversationProjection {
    let mut state = ConversationProjection::new(ConversationId::from_uuid(id(1)));
    state.apply(&started()).unwrap();
    apply(
        &mut state,
        EventPayload::PhaseChanged {
            turn_id: id(2),
            phase: TurnPhase::RunningModel,
        },
    );
    apply(
        &mut state,
        EventPayload::ModelRequestStarted {
            turn_id: id(2),
            attempt_id: id(50),
            model: ModelIdentity {
                provider_id: "test".into(),
                model_id: "test".into(),
                revision: None,
            },
        },
    );
    if interleaved {
        apply(
            &mut state,
            EventPayload::ModelOutputInterleavingStarted {
                turn_id: id(2),
                attempt_id: id(50),
            },
        );
    }
    apply(
        &mut state,
        EventPayload::ModelResponseStarted {
            turn_id: id(2),
            attempt_id: id(50),
            response_id: "r1".into(),
            model: None,
        },
    );
    state
}

#[test]
fn explicit_interleaving_preserves_legacy_order_and_positions_live_drafts() {
    for interleaved in [false, true] {
        let mut state = sampling_with_ordering(interleaved);
        apply(
            &mut state,
            EventPayload::ItemAccepted {
                turn_id: id(2),
                item_id: id(10),
                kind: ItemKind::ToolCall {
                    call_id: id(20),
                    name: "read".into(),
                    provider_call_id: Some("call".into()),
                    namespace: None,
                },
                text: "{}".into(),
                phase: None,
                source: Some(CanonicalItemSource {
                    attempt_id: id(50),
                    ordinal: 0,
                    provider_item_id: Some("call-item".into()),
                    provider_data_json: None,
                }),
            },
        );
        apply(
            &mut state,
            EventPayload::ItemStarted {
                turn_id: id(2),
                item_id: id(11),
                kind: ItemKind::ToolResult {
                    call_id: id(20),
                    is_error: Some(false),
                },
            },
        );
        apply(
            &mut state,
            EventPayload::ItemCompleted {
                turn_id: id(2),
                item_id: id(11),
            },
        );
        let cutoff = state.seq();
        apply(
            &mut state,
            EventPayload::ItemStarted {
                turn_id: id(2),
                item_id: id(12),
                kind: ItemKind::AssistantMessage,
            },
        );
        let expected = if interleaved {
            vec![id(10), id(12), id(11)]
        } else {
            vec![id(10), id(11), id(12)]
        };
        assert_eq!(state.turn(id(2)).unwrap().item_order, expected);
        apply(&mut state, accepted(12, 1, "later"));
        assert_eq!(state.turn(id(2)).unwrap().item_order, expected);
        apply(
            &mut state,
            EventPayload::ModelRequestFinished {
                turn_id: id(2),
                attempt_id: id(50),
                input_tokens: None,
                output_tokens: None,
            },
        );
        apply(
            &mut state,
            EventPayload::TurnFinished {
                turn_id: id(2),
                outcome: TurnOutcome::Completed,
            },
        );
        assert_eq!(state.context_tail(cutoff).is_err(), interleaved);
    }
}

#[test]
fn marked_later_attempt_never_reorders_a_previous_attempt_result() {
    let mut state = sampling_with_ordering(true);
    apply(
        &mut state,
        EventPayload::ItemAccepted {
            turn_id: id(2),
            item_id: id(10),
            kind: ItemKind::ToolCall {
                call_id: id(20),
                name: "read".into(),
                provider_call_id: Some("call".into()),
                namespace: None,
            },
            text: "{}".into(),
            phase: None,
            source: Some(CanonicalItemSource {
                attempt_id: id(50),
                ordinal: 0,
                provider_item_id: Some("call-item".into()),
                provider_data_json: None,
            }),
        },
    );
    apply(
        &mut state,
        EventPayload::ItemStarted {
            turn_id: id(2),
            item_id: id(11),
            kind: ItemKind::ToolResult {
                call_id: id(20),
                is_error: Some(false),
            },
        },
    );
    apply(
        &mut state,
        EventPayload::ItemCompleted {
            turn_id: id(2),
            item_id: id(11),
        },
    );
    apply(
        &mut state,
        EventPayload::ModelRequestFinished {
            turn_id: id(2),
            attempt_id: id(50),
            input_tokens: None,
            output_tokens: None,
        },
    );
    let model = ModelIdentity {
        provider_id: "test".into(),
        model_id: "test".into(),
        revision: None,
    };
    apply(
        &mut state,
        EventPayload::ModelRequestStarted {
            turn_id: id(2),
            attempt_id: id(51),
            model,
        },
    );
    apply(
        &mut state,
        EventPayload::ModelOutputInterleavingStarted {
            turn_id: id(2),
            attempt_id: id(51),
        },
    );
    apply(
        &mut state,
        EventPayload::ModelResponseStarted {
            turn_id: id(2),
            attempt_id: id(51),
            response_id: "r2".into(),
            model: None,
        },
    );
    apply(
        &mut state,
        EventPayload::ItemStarted {
            turn_id: id(2),
            item_id: id(12),
            kind: ItemKind::AssistantMessage,
        },
    );
    assert_eq!(
        state.turn(id(2)).unwrap().item_order,
        [id(10), id(11), id(12)]
    );
}

#[test]
fn interleaving_marker_is_bound_to_a_single_unstarted_response() {
    let mut state = ConversationProjection::new(ConversationId::from_uuid(id(1)));
    state.apply(&started()).unwrap();
    apply(
        &mut state,
        EventPayload::PhaseChanged {
            turn_id: id(2),
            phase: TurnPhase::RunningModel,
        },
    );
    apply(
        &mut state,
        EventPayload::ModelRequestStarted {
            turn_id: id(2),
            attempt_id: id(50),
            model: ModelIdentity {
                provider_id: "test".into(),
                model_id: "test".into(),
                revision: None,
            },
        },
    );
    assert!(!state.turn(id(2)).unwrap().attempts[&id(50)].interleaved_tool_results);
    let marker = EventPayload::ModelOutputInterleavingStarted {
        turn_id: id(2),
        attempt_id: id(50),
    };
    let mut with_draft = state.clone();
    apply(
        &mut with_draft,
        EventPayload::ItemStarted {
            turn_id: id(2),
            item_id: id(10),
            kind: ItemKind::AssistantMessage,
        },
    );
    assert!(
        with_draft
            .apply(&event(with_draft.seq() + 1, marker.clone()))
            .is_err()
    );
    let encoded = serde_json::to_vec(&event(state.seq() + 1, marker.clone())).unwrap();
    let wire: serde_json::Value = serde_json::from_slice(&encoded).unwrap();
    assert_eq!(wire["payload"]["type"], "modelOutputInterleavingStarted");
    assert_eq!(wire["payload"]["attemptId"], id(50).to_string());
    let decoded: AgentEvent = serde_json::from_slice(&encoded).unwrap();
    state.apply(&decoded).unwrap();
    assert!(state.turn(id(2)).unwrap().attempts[&id(50)].interleaved_tool_results);
    let before = state.clone();
    assert!(state.apply(&event(state.seq() + 1, marker)).is_err());
    assert_eq!(state, before);
    let mut late = sampling();
    assert!(
        late.apply(&event(
            late.seq() + 1,
            EventPayload::ModelOutputInterleavingStarted {
                turn_id: id(2),
                attempt_id: id(50)
            }
        ))
        .is_err()
    );
}
fn accepted(item: u128, ordinal: u32, text: &str) -> EventPayload {
    EventPayload::ItemAccepted {
        turn_id: id(2),
        item_id: id(item),
        kind: ItemKind::AssistantMessage,
        text: text.into(),
        phase: Some(AssistantMessagePhase::Commentary),
        source: Some(CanonicalItemSource {
            attempt_id: id(50),
            ordinal,
            provider_item_id: Some(format!("message-{item}")),
            provider_data_json: Some("{\"version\":1}".into()),
        }),
    }
}

#[test]
fn accepted_item_is_complete_and_ordered_before_response_terminal() {
    let mut state = sampling();
    apply(
        &mut state,
        EventPayload::ItemStarted {
            turn_id: id(2),
            item_id: id(10),
            kind: ItemKind::AssistantMessage,
        },
    );
    apply(
        &mut state,
        EventPayload::TextDelta {
            turn_id: id(2),
            item_id: id(10),
            text: "A".into(),
        },
    );
    apply(&mut state, accepted(11, 0, "B"));
    apply(&mut state, accepted(10, 1, "A"));
    let turn = state.turn(id(2)).unwrap();
    assert_eq!(turn.item_order, [id(11), id(10)]);
    assert!(turn.items[&id(10)].completed);
    assert_eq!(turn.items[&id(10)].source.as_ref().unwrap().ordinal, 1);
    assert_eq!(turn.attempts[&id(50)].actual_model, None);
    let before = state.clone();
    assert!(
        state
            .apply(&event(
                state.seq() + 1,
                EventPayload::ModelOutputOrder {
                    turn_id: id(2),
                    item_ids: vec![id(10), id(11)],
                }
            ))
            .is_err()
    );
    assert_eq!(state, before);
    apply(
        &mut state,
        EventPayload::ModelRequestFailed {
            turn_id: id(2),
            attempt_id: id(50),
            error: "connection failed".into(),
            retryable: true,
            category: None,
        },
    );
    assert!(
        state
            .turn(id(2))
            .unwrap()
            .items
            .values()
            .all(|item| item.completed && !item.interrupted)
    );
}

#[test]
fn invalid_acceptance_does_not_partially_complete_or_reorder_a_draft() {
    let mut state = sampling();
    apply(
        &mut state,
        EventPayload::ItemStarted {
            turn_id: id(2),
            item_id: id(10),
            kind: ItemKind::AssistantMessage,
        },
    );
    apply(
        &mut state,
        EventPayload::TextDelta {
            turn_id: id(2),
            item_id: id(10),
            text: "draft".into(),
        },
    );
    let mut legacy = accepted(10, 0, "different");
    if let EventPayload::ItemAccepted { source, .. } = &mut legacy {
        *source = None;
    }
    for bad in [legacy, accepted(11, 1, "ordinal gap")] {
        let before = state.clone();
        assert!(state.apply(&event(state.seq() + 1, bad)).is_err());
        assert_eq!(state, before);
    }
}

#[test]
fn authoritative_message_corrects_current_draft_atomically_and_cannot_reopen_it() {
    let mut state = sampling();
    for payload in [
        EventPayload::ItemStarted {
            turn_id: id(2),
            item_id: id(10),
            kind: ItemKind::AssistantMessage,
        },
        EventPayload::ItemPhaseChanged {
            turn_id: id(2),
            item_id: id(10),
            phase: AssistantMessagePhase::Commentary,
            native: true,
        },
        EventPayload::TextDelta {
            turn_id: id(2),
            item_id: id(10),
            text: "draft🙂".into(),
        },
    ] {
        apply(&mut state, payload);
    }
    let mut corrected = accepted(10, 0, "corrected🧪");
    if let EventPayload::ItemAccepted { phase, .. } = &mut corrected {
        *phase = Some(AssistantMessagePhase::FinalAnswer);
    }
    let mut invalid = corrected.clone();
    if let EventPayload::ItemAccepted {
        source: Some(source),
        ..
    } = &mut invalid
    {
        source.ordinal = 1;
    }
    let before = state.clone();
    assert!(state.apply(&event(state.seq() + 1, invalid)).is_err());
    assert_eq!(state, before);
    apply(&mut state, corrected.clone());
    let item = &state.turn(id(2)).unwrap().items[&id(10)];
    assert_eq!(item.text, "corrected🧪");
    assert_eq!(item.native_phase, Some(AssistantMessagePhase::FinalAnswer));
    assert_eq!(item.model_attempt_id, Some(id(50)));
    assert!(item.completed && item.accepted);
    let completed = state.clone();
    assert!(state.apply(&event(state.seq() + 1, corrected)).is_err());
    assert_eq!(state, completed);
}

#[test]
fn a_later_attempt_cannot_adopt_an_old_assistant_draft_even_with_identical_text() {
    for failed in [false, true] {
        let mut state = sampling();
        for payload in [
            EventPayload::ItemStarted {
                turn_id: id(2),
                item_id: id(10),
                kind: ItemKind::AssistantMessage,
            },
            EventPayload::TextDelta {
                turn_id: id(2),
                item_id: id(10),
                text: "draft".into(),
            },
        ] {
            apply(&mut state, payload);
        }
        apply(
            &mut state,
            if failed {
                EventPayload::ModelRequestFailed {
                    turn_id: id(2),
                    attempt_id: id(50),
                    error: "fixture".into(),
                    retryable: true,
                    category: None,
                }
            } else {
                EventPayload::ModelRequestFinished {
                    turn_id: id(2),
                    attempt_id: id(50),
                    input_tokens: None,
                    output_tokens: None,
                }
            },
        );
        apply(
            &mut state,
            EventPayload::ModelRequestStarted {
                turn_id: id(2),
                attempt_id: id(51),
                model: ModelIdentity {
                    provider_id: "test".into(),
                    model_id: "test".into(),
                    revision: None,
                },
            },
        );
        apply(
            &mut state,
            EventPayload::ModelResponseStarted {
                turn_id: id(2),
                attempt_id: id(51),
                response_id: "r2".into(),
                model: None,
            },
        );
        let mut completion = accepted(10, 0, "draft");
        if let EventPayload::ItemAccepted {
            source: Some(source),
            ..
        } = &mut completion
        {
            source.attempt_id = id(51);
        }
        let before = state.clone();
        assert!(state.apply(&event(state.seq() + 1, completion)).is_err());
        assert_eq!(state, before);
    }
}

#[test]
fn absent_actual_model_remains_unknown_until_explicit_observation() {
    let mut state = sampling();
    let model = ModelIdentity {
        provider_id: "test".into(),
        model_id: "observed".into(),
        revision: None,
    };
    apply(
        &mut state,
        EventPayload::ModelIdentityObserved {
            turn_id: id(2),
            attempt_id: id(50),
            model: model.clone(),
        },
    );
    assert_eq!(
        state.turn(id(2)).unwrap().attempts[&id(50)].actual_model,
        Some(model)
    );
    let updated = ModelIdentity {
        provider_id: "test".into(),
        model_id: "server-updated".into(),
        revision: None,
    };
    apply(
        &mut state,
        EventPayload::ModelIdentityObserved {
            turn_id: id(2),
            attempt_id: id(50),
            model: updated.clone(),
        },
    );
    assert_eq!(
        state.turn(id(2)).unwrap().attempts[&id(50)].actual_model,
        Some(updated)
    );
}

#[test]
fn model_response_cannot_precede_request_or_overwrite_recorded_identity() {
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
    let response = EventPayload::ModelResponseStarted {
        turn_id: id(2),
        attempt_id: id(80),
        response_id: "response".into(),
        model: Some(model.clone()),
    };
    let before = state.clone();
    assert!(state.apply(&event(3, response.clone())).is_err());
    assert_eq!(state, before);
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
    state.apply(&event(4, response.clone())).unwrap();
    let before = state.clone();
    assert!(state.apply(&event(5, response)).is_err());
    assert_eq!(state, before);
}
