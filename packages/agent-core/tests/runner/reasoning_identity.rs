use super::*;

#[tokio::test]
async fn fresh_source_identity_capacity_is_a_model_budget_error_and_counts_unicode_characters() {
    for kind in ["summary", "message", "opaque"] {
        for (id, expected) in [
            ("a".repeat(257), Some(ModelError::BudgetExceeded)),
            ("名".repeat(257), Some(ModelError::BudgetExceeded)),
            ("名".repeat(256), None),
            (" \t".into(), Some(ModelError::InvalidStream)),
        ] {
            let item = match kind {
                "summary" => CompletedModelItem {
                    canonical_item_id: None,
                    native: None,
                    normalized: Some(ModelOutputItem::ReasoningSummary(ReasoningSummary {
                        item_id: id.clone(),
                        text: "fact".into(),
                        parts: vec![ReasoningSummaryPart {
                            index: 0.into(),
                            start_byte: 0,
                            len_byte: 4,
                        }],
                    })),
                },
                "message" => CompletedModelItem {
                    canonical_item_id: None,
                    native: None,
                    normalized: Some(ModelOutputItem::Message(AssistantMessage {
                        item_id: id.clone(),
                        text: "fact".into(),
                        phase: None,
                    })),
                },
                _ => {
                    let mut native = NativeItemData::new(
                        "fixture".into(),
                        model(),
                        "reasoning".into(),
                        json!({"opaque":"fixture"}),
                    );
                    native.item_id = Some(id.clone());
                    CompletedModelItem {
                        canonical_item_id: None,
                        native: Some(Box::new(native)),
                        normalized: None,
                    }
                }
            };
            let (transport, sink, ids, request) = setup(vec![vec![
                begin(),
                ModelStreamEvent::OutputItemDone(Box::new(item)),
                ModelStreamEvent::Completed {
                    reason: FinishReason::Stop,
                    end_turn: None,
                },
            ]]);
            let tools = Tools {
                sink: &sink,
                executed: AtomicUsize::new(0),
            };
            let result = TurnRunner {
                transport: &transport,
                tools: &tools,
                sink: &sink,
                ids: &ids,
                limits: limits(),
            }
            .run(Uuid::from_u128(2), request)
            .await;
            let projection = sink.projection.lock().unwrap();
            let turn = projection.turn(Uuid::from_u128(2)).unwrap();
            if let Some(expected) = expected {
                assert!(matches!(result,Err(RunError::Model(actual))if actual==expected));
                assert_eq!(
                    turn.failure.as_ref().map(|(_, category)| *category),
                    Some(FailureCategory::Provider)
                );
                assert!(!turn.items.values().any(|item| item.accepted));
            } else {
                result.unwrap();
                assert_eq!(turn.outcome, Some(TurnOutcome::Completed));
                assert!(turn.items.values().any(|item| {
                    item.accepted
                        && item.completed
                        && item
                            .source
                            .as_ref()
                            .and_then(|source| source.provider_item_id.as_ref())
                            == Some(&id)
                }));
            }
        }
    }
}
