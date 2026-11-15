//! Shared golden generated from the same validated Rust event constructors.
use research_agent_core::{
    conversation::{ConversationExport, ConversationId, ConversationSummary},
    protocol::*,
};
use uuid::Uuid;

fn id(value: u128) -> Uuid {
    Uuid::from_u128(value)
}
fn model() -> ModelIdentity {
    ModelIdentity {
        provider_id: "fixture".into(),
        model_id: "reasoning".into(),
        revision: Some("1".into()),
    }
}
fn source(attempt: u128, ordinal: u32, provider: &str) -> Option<CanonicalItemSource> {
    Some(CanonicalItemSource {
        attempt_id: id(attempt),
        ordinal,
        provider_item_id: Some(provider.into()),
        provider_data_json: None,
    })
}
fn main() {
    let turn = id(2);
    let mut events = vec![];
    let mut emit = |payload| {
        events.push(
            AgentEvent::new(
                ConversationId::from_uuid(id(1)),
                events.len() as u64 + 1,
                1_700_000_000_000 + events.len() as u64,
                id(4),
                payload,
            )
            .unwrap(),
        )
    };
    emit(EventPayload::TurnStarted {
        turn_id: turn,
        context_snapshot_id: id(3),
        model: model(),
        task_kind: TaskKind::Regular,
    });
    emit(EventPayload::PhaseChanged {
        turn_id: turn,
        phase: TurnPhase::RunningModel,
    });
    emit(EventPayload::ModelRequestStarted {
        turn_id: turn,
        attempt_id: id(10),
        model: model(),
    });
    emit(EventPayload::ModelResponseStarted {
        turn_id: turn,
        attempt_id: id(10),
        response_id: "r1".into(),
        model: None,
    });
    emit(EventPayload::ItemStarted {
        turn_id: turn,
        item_id: id(20),
        kind: ItemKind::ReasoningSummary { parts: vec![] },
    });
    emit(EventPayload::ReasoningSummaryPartAdded {
        turn_id: turn,
        item_id: id(20),
        summary_index: i64::MIN.into(),
    });
    for (index, text) in [(i64::MIN, "A1你"), (i64::MAX, "B🦀"), (i64::MIN, "A2")] {
        emit(EventPayload::ReasoningSummaryDelta {
            turn_id: turn,
            item_id: id(20),
            summary_index: index.into(),
            text: text.into(),
        });
    }
    emit(EventPayload::ItemAccepted {
        turn_id: turn,
        item_id: id(20),
        kind: ItemKind::ReasoningSummary {
            parts: vec![
                ReasoningSummaryPart {
                    index: 0.into(),
                    start_byte: 0,
                    len_byte: 9,
                },
                ReasoningSummaryPart {
                    index: 1.into(),
                    start_byte: 9,
                    len_byte: 4,
                },
            ],
        },
        text: "完成你🙂".into(),
        phase: None,
        source: source(10, 0, "rs-one"),
    });
    emit(EventPayload::ItemStarted {
        turn_id: turn,
        item_id: id(21),
        kind: ItemKind::ReasoningSummary { parts: vec![] },
    });
    emit(EventPayload::ReasoningSummaryPartAdded {
        turn_id: turn,
        item_id: id(21),
        summary_index: (-1).into(),
    });
    emit(EventPayload::ReasoningSummaryDelta {
        turn_id: turn,
        item_id: id(21),
        summary_index: (-1).into(),
        text: "interrupted".into(),
    });
    emit(EventPayload::ModelRequestFailed {
        turn_id: turn,
        attempt_id: id(10),
        error: "model response ended before completion".into(),
        retryable: true,
        category: Some(FailureCategory::Provider),
    });
    emit(EventPayload::ModelRequestStarted {
        turn_id: turn,
        attempt_id: id(11),
        model: model(),
    });
    emit(EventPayload::ModelResponseStarted {
        turn_id: turn,
        attempt_id: id(11),
        response_id: "r2".into(),
        model: None,
    });
    emit(EventPayload::ItemAccepted {
        turn_id: turn,
        item_id: id(22),
        kind: ItemKind::ReasoningSummary {
            parts: vec![ReasoningSummaryPart {
                index: 9_007_199_254_740_993i64.into(),
                start_byte: 0,
                len_byte: 6,
            }],
        },
        text: "稀疏".into(),
        phase: None,
        source: source(11, 0, "rs-sparse"),
    });
    emit(EventPayload::ItemAccepted {
        turn_id: turn,
        item_id: id(23),
        kind: ItemKind::ReasoningSummary { parts: vec![] },
        text: String::new(),
        phase: None,
        source: source(11, 1, "rs-empty"),
    });
    emit(EventPayload::ModelRequestFinished {
        turn_id: turn,
        attempt_id: id(11),
        input_tokens: None,
        output_tokens: None,
    });
    emit(EventPayload::TurnFinished {
        turn_id: turn,
        outcome: TurnOutcome::Completed,
    });
    let mut projection = ConversationProjection::new(ConversationId::from_uuid(id(1)));
    for event in &events {
        projection
            .apply(event)
            .unwrap_or_else(|error| panic!("event {}: {error}", event.seq()));
    }
    if std::env::args().nth(1).as_deref() == Some("--export") {
        let export = ConversationExport::from_projection(
            ConversationSummary {
                id: ConversationId::from_uuid(id(1)),
                title: "Synthetic reasoning facts".into(),
                internal: false,
                archived: false,
                durable_count: events.len() as u64,
                created_at: "2026-10-26T00:00:00.000Z".into(),
                updated_at: "2026-10-26T00:00:00.000Z".into(),
            },
            &projection,
        )
        .unwrap();
        println!("{}", serde_json::to_string_pretty(&export).unwrap());
    } else {
        println!("{}", serde_json::to_string_pretty(&events).unwrap());
    }
}
