use super::*;
use research_agent_core::conversation::*;

fn emit(history: &mut ConversationProjection, events: &mut Vec<AgentEvent>, payload: EventPayload) {
    let event = AgentEvent::new(
        history.conversation_id(),
        history.seq() + 1,
        0,
        Uuid::from_u128(900),
        payload,
    )
    .unwrap();
    history
        .apply(&event)
        .unwrap_or_else(|error| panic!("seq {} {:?}: {error:?}", event.seq(), event.payload()));
    events.push(event);
}

fn turn(history: &mut ConversationProjection, events: &mut Vec<AgentEvent>, number: u128) -> u64 {
    let turn_id = Uuid::from_u128(number);
    let attempt_id = Uuid::from_u128(number + 1);
    let user = Uuid::from_u128(number + 2);
    for payload in [
        EventPayload::TurnStarted {
            turn_id,
            context_snapshot_id: Uuid::from_u128(number + 3),
            model: model(),
            task_kind: TaskKind::Regular,
        },
        EventPayload::ItemStarted {
            turn_id,
            item_id: user,
            kind: ItemKind::UserMessage,
        },
        EventPayload::TextDelta {
            turn_id,
            item_id: user,
            text: format!("user {number}"),
        },
        EventPayload::ItemCompleted {
            turn_id,
            item_id: user,
        },
    ] {
        emit(history, events, payload);
    }
    let cutoff = history.seq();
    emit(
        history,
        events,
        EventPayload::PhaseChanged {
            turn_id,
            phase: TurnPhase::RunningModel,
        },
    );
    emit(
        history,
        events,
        EventPayload::ModelRequestStarted {
            turn_id,
            attempt_id,
            model: model(),
        },
    );
    emit(
        history,
        events,
        EventPayload::ModelResponseStarted {
            turn_id,
            attempt_id,
            response_id: "response".into(),
            model: None,
        },
    );
    for (ordinal, kind, text, provider) in [
        (
            0,
            ItemKind::ProviderNative {
                item_type: "reasoning".into(),
            },
            "",
            "r",
        ),
        (1, ItemKind::AssistantMessage, "answer", "m"),
    ] {
        emit(
            history,
            events,
            EventPayload::ItemAccepted {
                turn_id,
                item_id: Uuid::from_u128(number + 4 + ordinal as u128),
                kind,
                text: text.into(),
                phase: None,
                source: Some(CanonicalItemSource {
                    attempt_id,
                    ordinal,
                    provider_item_id: Some(provider.into()),
                    provider_data_json: Some(
                        native(if ordinal == 0 { "reasoning" } else { "message" }, provider)
                            .to_json()
                            .unwrap(),
                    ),
                }),
            },
        );
    }
    emit(
        history,
        events,
        EventPayload::ModelRequestFinished {
            turn_id,
            attempt_id,
            input_tokens: None,
            output_tokens: None,
        },
    );
    emit(
        history,
        events,
        EventPayload::TurnFinished {
            turn_id,
            outcome: TurnOutcome::Completed,
        },
    );
    cutoff
}

#[test]
fn fork_rollback_and_context_tail_retain_native_facts_and_local_handles() {
    let parent = ConversationId::from_uuid(Uuid::from_u128(1));
    let mut history = ConversationProjection::new(parent);
    let mut events = vec![];
    let first_cutoff = turn(&mut history, &mut events, 100);
    let first_messages = reconstruct_history(&history).unwrap();
    let second_cutoff = turn(&mut history, &mut events, 200);
    let tail = reconstruct_history_after_checkpoint(
        &history,
        &Default::default(),
        &Default::default(),
        second_cutoff,
    )
    .unwrap();
    assert_eq!(tail.len(), 2);
    assert!(
        matches!(&tail[0],ModelMessage::CanonicalOutput(item) if item.canonical_item_id==Some(Uuid::from_u128(204))&&item.normalized.is_none()&&item.native.as_ref().unwrap().data["item"]["encrypted_content"]=="opaque-signature")
    );

    let child = ConversationId::from_uuid(Uuid::from_u128(2));
    let inherited = materialize_fork_history(
        &ConversationForkRequest {
            child_id: child,
            parent_id: parent,
            through_turn_id: Uuid::from_u128(100),
            binding: ConversationBinding {
                kind: BindingKind::Note,
                resource_id: "fixture".into(),
            },
        },
        &events,
    )
    .unwrap();
    let mut fork = ConversationProjection::new(child);
    for event in inherited {
        fork.apply(&event).unwrap();
    }
    assert!(reconstruct_history(&fork).unwrap() == first_messages);
    assert_eq!(
        reconstruct_history_after_checkpoint(
            &fork,
            &Default::default(),
            &Default::default(),
            first_cutoff
        )
        .unwrap()
        .len(),
        2
    );

    emit(
        &mut history,
        &mut events,
        EventPayload::ConversationRolledBack {
            turn_id: Uuid::from_u128(200),
            user_turns: 1,
        },
    );
    assert!(reconstruct_history(&history).unwrap() == first_messages);
    let export = ConversationExport::from_projection(
        ConversationSummary {
            internal: false,
            id: parent,
            title: "fixture".into(),
            archived: false,
            durable_count: history.seq(),
            created_at: "now".into(),
            updated_at: "now".into(),
        },
        &history,
    )
    .unwrap();
    let exported = serde_json::to_string(&export).unwrap();
    assert!(exported.contains("providerNative"));
    assert!(!exported.contains("opaque-signature"));
    assert!(!exported.contains("encrypted_content"));
    let mut reopened = ConversationProjection::new(parent);
    for event in events {
        reopened.apply(&event).unwrap();
    }
    assert_eq!(reopened, history);
}
