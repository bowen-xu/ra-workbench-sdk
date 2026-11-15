use super::*;

fn emit(state: &mut ConversationProjection, payload: EventPayload) {
    state.apply(&event(state.seq() + 1, payload)).unwrap();
}
fn item(state: &mut ConversationProjection, value: u128, kind: ItemKind, complete: bool) {
    emit(
        state,
        EventPayload::ItemStarted {
            turn_id: id(2),
            item_id: id(value),
            kind,
        },
    );
    if complete {
        emit(
            state,
            EventPayload::ItemCompleted {
                turn_id: id(2),
                item_id: id(value),
            },
        );
    }
}

#[test]
fn ordering_fact_only_permutes_once_the_complete_output_suffix() {
    let mut state = ConversationProjection::new(ConversationId::from_uuid(id(1)));
    state.apply(&started()).unwrap();
    item(&mut state, 10, ItemKind::UserMessage, true);
    item(&mut state, 11, ItemKind::AssistantMessage, true);
    item(
        &mut state,
        12,
        ItemKind::ToolCall {
            call_id: id(22),
            name: "read".into(),
            provider_call_id: Some("call".into()),
            namespace: None,
        },
        true,
    );
    let order = |ids| EventPayload::ModelOutputOrder {
        turn_id: id(2),
        item_ids: ids,
    };
    // A suffix cannot contain user input or reach back across another item.
    assert!(
        state
            .apply(&event(state.seq() + 1, order(vec![id(10), id(11), id(12)])))
            .is_err()
    );
    assert!(
        state
            .apply(&event(state.seq() + 1, order(vec![id(11)])))
            .is_err()
    );
    assert!(
        AgentEvent::new(
            ConversationId::from_uuid(id(1)),
            state.seq() + 1,
            0,
            id(4),
            order(vec![id(12), id(12)])
        )
        .is_err()
    );
    emit(&mut state, order(vec![id(12), id(11)]));
    assert_eq!(
        state.turn(id(2)).unwrap().item_order,
        vec![id(10), id(12), id(11)]
    );
    assert!(
        state
            .apply(&event(state.seq() + 1, order(vec![id(11), id(12)])))
            .is_err()
    );
    item(
        &mut state,
        13,
        ItemKind::ToolResult {
            call_id: id(22),
            is_error: Some(false),
        },
        true,
    );
    assert!(
        state
            .apply(&event(state.seq() + 1, order(vec![id(13)])))
            .is_err()
    );
    item(&mut state, 14, ItemKind::AssistantMessage, false);
    assert!(
        state
            .apply(&event(state.seq() + 1, order(vec![id(14)])))
            .is_err()
    );
}

#[test]
fn native_phase_provenance_is_explicit_and_legacy_wire_remains_unchanged() {
    let payload = |native| EventPayload::ItemPhaseChanged {
        turn_id: id(2),
        item_id: id(10),
        phase: AssistantMessagePhase::Commentary,
        native,
    };
    let legacy = serde_json::to_value(event(2, payload(false))).unwrap();
    assert!(legacy["payload"].get("native").is_none());
    let native = serde_json::to_value(event(2, payload(true))).unwrap();
    assert_eq!(native["payload"]["native"], true);
    let mut state = ConversationProjection::new(ConversationId::from_uuid(id(1)));
    state.apply(&started()).unwrap();
    item(&mut state, 10, ItemKind::AssistantMessage, false);
    emit(&mut state, payload(false));
    assert_eq!(state.turn(id(2)).unwrap().items[&id(10)].native_phase, None);
    assert!(
        AgentEvent::new(
            ConversationId::from_uuid(id(1)),
            state.seq() + 1,
            0,
            id(4),
            EventPayload::ItemPhaseChanged {
                turn_id: id(2),
                item_id: id(10),
                phase: AssistantMessagePhase::Reasoning,
                native: true
            }
        )
        .is_err()
    );
}
