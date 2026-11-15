use research_agent_core::{model::*, protocol::*};
use uuid::Uuid;

fn model() -> ModelIdentity {
    ModelIdentity {
        provider_id: "fixture".into(),
        model_id: "reasoning".into(),
        revision: None,
    }
}
fn assembler(text_bytes: usize) -> ResponseAssembler {
    let mut result = ResponseAssembler::new(StreamLimits {
        text_bytes,
        argument_bytes: 1024,
        tool_calls: 8,
    })
    .unwrap();
    result
        .push(ModelStreamEvent::Started {
            response_id: "response".into(),
            actual_model: model(),
        })
        .unwrap();
    result
}
fn delta(id: &str, index: i64, text: &str) -> ModelStreamEvent {
    ModelStreamEvent::ReasoningSummaryDelta {
        item_id: id.into(),
        summary_index: index.into(),
        text: text.into(),
    }
}
fn done(id: &str, text: &str) -> ModelStreamEvent {
    ModelStreamEvent::OutputItemDone(Box::new(CompletedModelItem {
        canonical_item_id: None,
        native: None,
        normalized: Some(ModelOutputItem::ReasoningSummary(ReasoningSummary {
            item_id: id.into(),
            text: text.into(),
            parts: vec![ReasoningSummaryPart {
                index: 0.into(),
                start_byte: 0,
                len_byte: text.len(),
            }],
        })),
    }))
}
fn end() -> ModelStreamEvent {
    ModelStreamEvent::Completed {
        reason: FinishReason::Stop,
        end_turn: None,
    }
}

#[test]
fn summary_completion_replaces_its_draft_and_never_becomes_assistant_final_text() {
    let mut stream = assembler(1024);
    stream
        .push(ModelStreamEvent::ReasoningSummaryStarted {
            item_id: "rs".into(),
        })
        .unwrap();
    for event in [
        delta("rs", i64::MIN, "A1"),
        delta("rs", i64::MAX, "B你"),
        delta("rs", i64::MIN, "A2"),
    ] {
        stream.push(event).unwrap();
    }
    let event = done("rs", "corrected🙂");
    stream.push(event.clone()).unwrap();
    assert!(
        matches!(stream.completed_item(&event).unwrap().unwrap().normalized,Some(ModelOutputItem::ReasoningSummary(ReasoningSummary{text,..}))if text=="corrected🙂")
    );
    stream.push(delta("rs", 0, "late ignored")).unwrap();
    stream.push(end()).unwrap();
    let response = stream.finish().unwrap();
    assert!(response.text.is_empty() && response.tool_calls.is_empty());
    assert!(
        matches!(&response.output[..],[ModelOutputItem::ReasoningSummary(summary)]if summary.text=="corrected🙂")
    );
}

#[test]
fn sparse_summaries_orphan_progress_and_an_empty_summary_keep_independent_identities() {
    let mut stream = assembler(1024);
    stream.push(delta("orphan", i64::MAX, "ignored")).unwrap();
    stream.push(done("one", "first")).unwrap();
    stream.push(done("empty", "")).unwrap();
    stream.push(done("two", "second")).unwrap();
    stream.push(end()).unwrap();
    let response = stream.finish().unwrap();
    assert_eq!(response.output.len(), 3);
    assert_eq!(response.text, "");
}

#[test]
fn public_summary_text_uses_existing_response_capacity_and_utf8_ranges_are_validated() {
    let mut stream = assembler(16);
    stream
        .push(ModelStreamEvent::ReasoningSummaryStarted {
            item_id: "rs".into(),
        })
        .unwrap();
    assert_eq!(
        stream.push(delta("rs", i64::MAX, &"x".repeat(17))),
        Err(ModelError::BudgetExceeded)
    );
    let mut stream = assembler(16);
    assert_eq!(
        stream.push(done("rs", &"x".repeat(17))),
        Err(ModelError::BudgetExceeded)
    );
    let summary = |start, len| CompletedModelItem {
        canonical_item_id: None,
        native: None,
        normalized: Some(ModelOutputItem::ReasoningSummary(ReasoningSummary {
            item_id: "rs".into(),
            text: "🙂".into(),
            parts: vec![ReasoningSummaryPart {
                index: 0.into(),
                start_byte: start,
                len_byte: len,
            }],
        })),
    };
    for item in [summary(1, 3), summary(0, 3), summary(0, usize::MAX)] {
        assert_eq!(item.validate(), Err(ModelError::InvalidStream));
    }
    assert!(summary(0, 4).validate().is_ok());
}

#[test]
fn public_summary_facts_survive_checkpoint_and_accounting_without_native_body_duplication() {
    use research_agent_core::context::{
        accounting::{ContextTokenEstimator, Utf8JsonTokenEstimator},
        checkpoint::{restore_messages, store_messages},
    };
    let ModelStreamEvent::OutputItemDone(item) = done("rs", "summary你") else {
        unreachable!()
    };
    let messages = vec![ModelMessage::CanonicalOutput(item)];
    let stored = store_messages(&messages).unwrap();
    assert!(restore_messages(&stored, &|_| None).unwrap() == messages);
    assert!(Utf8JsonTokenEstimator.estimate(&messages, &[]).unwrap() > 0);
    let request = ModelRequest {
        request_id: Uuid::from_u128(1),
        model: model(),
        messages,
        tools: vec![],
        max_output_tokens: 1,
        parallel_tool_calls: false,
        reasoning_effort: None,
        captured_history: None,
    };
    request
        .validate(ModelCapabilities {
            vision: false,
            tools: false,
            parallel_tools: false,
            reasoning_efforts: vec![],
        })
        .unwrap();
}

#[test]
fn shared_golden_replays_grouped_drafts_replaces_completion_and_exports_unfinished_parts() {
    use research_agent_core::conversation::{
        ConversationExport, ConversationId, ConversationSummary,
    };
    let events: Vec<AgentEvent> = serde_json::from_str(include_str!(
        "../../../tests/fixtures/agent-reasoning-summary-v1.json"
    ))
    .unwrap();
    let mut projection = ConversationProjection::new(ConversationId::from_uuid(Uuid::from_u128(1)));
    for event in &events {
        projection.apply(event).unwrap();
        if event.seq() == 9 {
            let draft = projection
                .turn(Uuid::from_u128(2))
                .unwrap()
                .items
                .get(&Uuid::from_u128(20))
                .unwrap();
            assert_eq!(draft.text, "A1你A2B🦀");
            assert_eq!(draft.reasoning_draft.as_ref().unwrap().parts().count(), 2);
        }
    }
    let turn = projection.turn(Uuid::from_u128(2)).unwrap();
    assert_eq!(turn.items[&Uuid::from_u128(20)].text, "完成你🙂");
    assert!(turn.items[&Uuid::from_u128(20)].reasoning_draft.is_none());
    assert!(turn.items[&Uuid::from_u128(21)].interrupted);
    let restored = reconstruct_history(&projection).unwrap();
    assert_eq!(restored.len(), 3);
    assert!(restored.iter().all(|message|matches!(message,ModelMessage::CanonicalOutput(item)if matches!(item.normalized,Some(ModelOutputItem::ReasoningSummary(_))))));
    let export = ConversationExport::from_projection(
        ConversationSummary {
            id: ConversationId::from_uuid(Uuid::from_u128(1)),
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
    let expected: serde_json::Value = serde_json::from_str(include_str!(
        "../../../tests/fixtures/agent-reasoning-summary-export-v1.json"
    ))
    .unwrap();
    assert_eq!(serde_json::to_value(export).unwrap(), expected);
}

#[test]
fn generic_text_and_completion_cannot_bypass_summary_parts_or_canonical_acceptance() {
    let events: Vec<AgentEvent> = serde_json::from_str(include_str!(
        "../../../tests/fixtures/agent-reasoning-summary-v1.json"
    ))
    .unwrap();
    let id = research_agent_core::conversation::ConversationId::from_uuid(Uuid::from_u128(1));
    let mut projection = ConversationProjection::new(id);
    for event in &events[..5] {
        projection.apply(event).unwrap();
    }
    for payload in [
        EventPayload::TextDelta {
            turn_id: Uuid::from_u128(2),
            item_id: Uuid::from_u128(20),
            text: "bypass".into(),
        },
        EventPayload::ItemCompleted {
            turn_id: Uuid::from_u128(2),
            item_id: Uuid::from_u128(20),
        },
    ] {
        let before = projection.clone();
        let event = AgentEvent::new(id, 6, 0, Uuid::from_u128(4), payload).unwrap();
        assert_eq!(
            projection.apply(&event),
            Err(ProjectionError::InvalidTransition)
        );
        assert_eq!(projection, before);
    }
}

#[test]
fn summary_drafts_require_a_model_attempt_and_cannot_receive_another_attempts_progress_or_source() {
    let events: Vec<AgentEvent> = serde_json::from_str(include_str!(
        "../../../tests/fixtures/agent-reasoning-summary-v1.json"
    ))
    .unwrap();
    let id = research_agent_core::conversation::ConversationId::from_uuid(Uuid::from_u128(1));
    let mut projection = ConversationProjection::new(id);
    projection.apply(&events[0]).unwrap();
    let start = AgentEvent::new(
        id,
        2,
        0,
        Uuid::from_u128(4),
        EventPayload::ItemStarted {
            turn_id: Uuid::from_u128(2),
            item_id: Uuid::from_u128(20),
            kind: ItemKind::ReasoningSummary { parts: vec![] },
        },
    )
    .unwrap();
    assert_eq!(
        projection.apply(&start),
        Err(ProjectionError::InvalidTransition)
    );
    for event in &events[1..5] {
        projection.apply(event).unwrap();
    }
    let emit = |projection: &mut ConversationProjection, payload| {
        projection.apply(
            &AgentEvent::new(id, projection.seq() + 1, 0, Uuid::from_u128(4), payload).unwrap(),
        )
    };
    emit(
        &mut projection,
        EventPayload::ModelRequestFinished {
            turn_id: Uuid::from_u128(2),
            attempt_id: Uuid::from_u128(10),
            input_tokens: None,
            output_tokens: None,
        },
    )
    .unwrap();
    emit(
        &mut projection,
        EventPayload::ModelRequestStarted {
            turn_id: Uuid::from_u128(2),
            attempt_id: Uuid::from_u128(11),
            model: model(),
        },
    )
    .unwrap();
    emit(
        &mut projection,
        EventPayload::ModelResponseStarted {
            turn_id: Uuid::from_u128(2),
            attempt_id: Uuid::from_u128(11),
            response_id: "new".into(),
            model: None,
        },
    )
    .unwrap();
    assert_eq!(
        emit(
            &mut projection,
            EventPayload::ReasoningSummaryDelta {
                turn_id: Uuid::from_u128(2),
                item_id: Uuid::from_u128(20),
                summary_index: 0.into(),
                text: "wrong attempt".into()
            }
        ),
        Err(ProjectionError::InvalidTransition)
    );
    assert_eq!(
        emit(
            &mut projection,
            EventPayload::ItemAccepted {
                turn_id: Uuid::from_u128(2),
                item_id: Uuid::from_u128(20),
                kind: ItemKind::ReasoningSummary { parts: vec![] },
                text: String::new(),
                phase: None,
                source: Some(CanonicalItemSource {
                    attempt_id: Uuid::from_u128(11),
                    ordinal: 0,
                    provider_item_id: Some("wrong-owner".into()),
                    provider_data_json: None
                })
            }
        ),
        Err(ProjectionError::InvalidTransition)
    );
    emit(
        &mut projection,
        EventPayload::ItemAccepted {
            turn_id: Uuid::from_u128(2),
            item_id: Uuid::from_u128(20),
            kind: ItemKind::ReasoningSummary { parts: vec![] },
            text: String::new(),
            phase: None,
            source: None,
        },
    )
    .unwrap();
    assert_eq!(
        projection.turn(Uuid::from_u128(2)).unwrap().items[&Uuid::from_u128(20)].model_attempt_id,
        Some(Uuid::from_u128(10))
    );
}

#[test]
fn standalone_source_null_summary_is_a_complete_common_fact_without_a_draft_attempt() {
    let events: Vec<AgentEvent> = serde_json::from_str(include_str!(
        "../../../tests/fixtures/agent-reasoning-summary-v1.json"
    ))
    .unwrap();
    let id = research_agent_core::conversation::ConversationId::from_uuid(Uuid::from_u128(1));
    let mut projection = ConversationProjection::new(id);
    projection.apply(&events[0]).unwrap();
    projection
        .apply(
            &AgentEvent::new(
                id,
                2,
                0,
                Uuid::from_u128(4),
                EventPayload::ItemAccepted {
                    turn_id: Uuid::from_u128(2),
                    item_id: Uuid::from_u128(20),
                    kind: ItemKind::ReasoningSummary { parts: vec![] },
                    text: String::new(),
                    phase: None,
                    source: None,
                },
            )
            .unwrap(),
        )
        .unwrap();
    assert!(
        projection.turn(Uuid::from_u128(2)).unwrap().items[&Uuid::from_u128(20)]
            .model_attempt_id
            .is_none()
    );
}

#[test]
fn messages_and_summaries_share_one_provider_item_identity_namespace() {
    for summary_first in [true, false] {
        let summary = done("same", "first");
        let message = ModelStreamEvent::OutputItemDone(Box::new(CompletedModelItem {
            canonical_item_id: None,
            native: None,
            normalized: Some(ModelOutputItem::Message(AssistantMessage {
                item_id: "same".into(),
                text: "first".into(),
                phase: None,
            })),
        }));
        let (first, second) = if summary_first {
            (summary, message)
        } else {
            (message, summary)
        };
        let mut stream = assembler(1024);
        stream.push(first).unwrap();
        assert_eq!(stream.push(second), Err(ModelError::InvalidStream));
        assert_eq!(stream.completed_items().len(), 1);
    }
}

#[test]
fn wider_historical_summary_ids_remain_valid_for_checkpoint_and_request_replay() {
    use research_agent_core::context::checkpoint::{restore_messages, store_messages};
    let item = CompletedModelItem {
        canonical_item_id: None,
        native: None,
        normalized: Some(ModelOutputItem::ReasoningSummary(ReasoningSummary {
            item_id: "名".repeat(257),
            text: "fact".into(),
            parts: vec![ReasoningSummaryPart {
                index: 0.into(),
                start_byte: 0,
                len_byte: 4,
            }],
        })),
    };
    item.validate().unwrap();
    let messages = vec![ModelMessage::CanonicalOutput(Box::new(item))];
    assert!(restore_messages(&store_messages(&messages).unwrap(), &|_| None).unwrap() == messages);
    ModelRequest {
        request_id: Uuid::from_u128(1),
        model: model(),
        messages,
        tools: vec![],
        max_output_tokens: 1,
        parallel_tool_calls: false,
        reasoning_effort: None,
        captured_history: None,
    }
    .validate(ModelCapabilities {
        vision: false,
        tools: false,
        parallel_tools: false,
        reasoning_efforts: vec![],
    })
    .unwrap();
}
