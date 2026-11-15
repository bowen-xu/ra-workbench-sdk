use super::*;

pub(super) fn summary(id: &str, text: &str) -> ModelStreamEvent {
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
#[tokio::test]
async fn public_summary_is_canonical_context_and_process_history_without_a_final_answer_fallback() {
    let events = vec![
        begin(),
        ModelStreamEvent::ReasoningSummaryStarted {
            item_id: "rs".into(),
        },
        ModelStreamEvent::ReasoningSummaryDelta {
            item_id: "rs".into(),
            summary_index: i64::MIN.into(),
            text: "draft你".into(),
        },
        summary("rs", "corrected🙂"),
        ModelStreamEvent::Completed {
            reason: FinishReason::Stop,
            end_turn: Some(false),
        },
    ];
    let (transport, sink, ids, request) = setup(vec![events, answer()]);
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
    .await
    .unwrap();
    assert!(result.responses[0].text.is_empty());
    assert!(transport.requests.lock().unwrap()[1].messages.iter().any(|message|matches!(message,ModelMessage::CanonicalOutput(item)if matches!(&item.normalized,Some(ModelOutputItem::ReasoningSummary(summary))if summary.text=="corrected🙂"))));
    let state = sink.projection.lock().unwrap();
    let turn = state.turn(Uuid::from_u128(2)).unwrap();
    assert_eq!(
        turn.items
            .values()
            .filter(|item| matches!(item.kind, ItemKind::ReasoningSummary { .. }))
            .count(),
        1
    );
    assert!(
        turn.items
            .values()
            .filter(|item| matches!(item.kind, ItemKind::AssistantMessage))
            .all(|item| item.text == "answer")
    );
    let summary = turn
        .items
        .values()
        .find(|item| matches!(item.kind, ItemKind::ReasoningSummary { .. }))
        .unwrap();
    assert!(summary.completed && summary.reasoning_draft.is_none());
    assert_eq!(tools.executed.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn sparse_completed_summary_keeps_its_closed_identity_when_start_and_delta_arrive_late() {
    for late_delta in [false, true] {
        let mut events = vec![
            begin(),
            summary("rs", "done"),
            ModelStreamEvent::ReasoningSummaryStarted {
                item_id: "rs".into(),
            },
        ];
        if late_delta {
            events.push(ModelStreamEvent::ReasoningSummaryDelta {
                item_id: "rs".into(),
                summary_index: 0.into(),
                text: "late ignored".into(),
            });
        }
        events.push(ModelStreamEvent::Completed {
            reason: FinishReason::Stop,
            end_turn: None,
        });
        let (transport, sink, ids, request) = setup(vec![events]);
        let tools = Tools {
            sink: &sink,
            executed: AtomicUsize::new(0),
        };
        TurnRunner {
            transport: &transport,
            tools: &tools,
            sink: &sink,
            ids: &ids,
            limits: RunLimits {
                output_bytes: Some(4),
                ..limits()
            },
        }
        .run(Uuid::from_u128(2), request)
        .await
        .unwrap();
        let projection = sink.projection.lock().unwrap();
        let turn = projection.turn(Uuid::from_u128(2)).unwrap();
        assert_eq!(turn.outcome, Some(TurnOutcome::Completed));
        let summaries = turn
            .items
            .values()
            .filter(|item| matches!(item.kind, ItemKind::ReasoningSummary { .. }))
            .collect::<Vec<_>>();
        assert_eq!(summaries.len(), 1);
        assert!(summaries[0].completed && summaries[0].reasoning_draft.is_none());
        assert_eq!(summaries[0].text, "done");
        assert_eq!(tools.executed.load(Ordering::SeqCst), 0);
    }
}

#[tokio::test]
async fn cross_kind_duplicate_provider_identity_is_a_model_failure_after_preserving_the_first_fact()
{
    for summary_first in [true, false] {
        let summary = summary("same", "first");
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
        let (transport, sink, ids, request) = setup(vec![vec![
            begin(),
            first,
            second,
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
        assert!(matches!(
            result,
            Err(RunError::Model(ModelError::InvalidStream))
        ));
        let projection = sink.projection.lock().unwrap();
        let turn = projection.turn(Uuid::from_u128(2)).unwrap();
        assert_eq!(
            turn.failure.as_ref().map(|(_, category)| *category),
            Some(FailureCategory::Provider)
        );
        let accepted = turn
            .items
            .values()
            .filter(|item| item.accepted)
            .collect::<Vec<_>>();
        assert_eq!(accepted.len(), 1);
        assert!(accepted[0].completed);
        assert_eq!(accepted[0].text, "first");
        assert_eq!(tools.executed.load(Ordering::SeqCst), 0);
    }
}
