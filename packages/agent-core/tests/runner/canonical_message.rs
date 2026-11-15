//! Derived from Codex OutputItemDone: the completed item owns body and phase.
use super::*;

fn corrected() -> Vec<ModelStreamEvent> {
    vec![
        begin(),
        ModelStreamEvent::AssistantMessageStarted {
            item_id: "m1".into(),
            phase: Some(AssistantMessagePhase::Commentary),
        },
        ModelStreamEvent::AssistantTextDelta {
            item_id: "m1".into(),
            text: "draft🙂".into(),
        },
        ModelStreamEvent::OutputItemDone(Box::new(CompletedModelItem {
            canonical_item_id: None,
            normalized: Some(ModelOutputItem::Message(AssistantMessage {
                item_id: "m1".into(),
                text: "corrected🧪".into(),
                phase: Some(AssistantMessagePhase::FinalAnswer),
            })),
            native: None,
        })),
        ModelStreamEvent::Completed {
            reason: FinishReason::Stop,
            end_turn: None,
        },
    ]
}

#[tokio::test]
async fn corrected_completion_enters_one_item_and_model_history_without_draft_concatenation() {
    let (transport, sink, ids, request) = setup(vec![corrected()]);
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
    let projection = sink.projection.lock().unwrap();
    let turn = projection.turn(Uuid::from_u128(2)).unwrap();
    assert_eq!(turn.items.len(), 1);
    let item = turn.items.values().next().unwrap();
    assert_eq!(item.text, "corrected🧪");
    assert_eq!(item.native_phase, Some(AssistantMessagePhase::FinalAnswer));
    assert!(item.completed && item.accepted);
    assert_eq!(turn.outcome, Some(TurnOutcome::Completed));
    assert_eq!(tools.executed.load(Ordering::SeqCst), 0);
    assert_eq!(transport.requests.lock().unwrap().len(), 1);
    assert_eq!(result.responses[0].text, "corrected🧪");
    assert!(
        matches!(&result.messages[1], ModelMessage::CanonicalOutput(item) if matches!(&item.normalized, Some(ModelOutputItem::Message(message)) if message.text == "corrected🧪"))
    );
}

#[tokio::test]
async fn corrected_completion_still_counts_both_observed_draft_and_new_body_against_turn_budget() {
    let (transport, sink, ids, request) = setup(vec![corrected()]);
    let tools = Tools {
        sink: &sink,
        executed: AtomicUsize::new(0),
    };
    let mut bounded = limits();
    bounded.output_bytes = Some("draft🙂".len() + "corrected🧪".len() - 1);
    assert!(matches!(
        TurnRunner {
            transport: &transport,
            tools: &tools,
            sink: &sink,
            ids: &ids,
            limits: bounded
        }
        .run(Uuid::from_u128(2), request)
        .await,
        Err(RunError::Budget)
    ));
    let projection = sink.projection.lock().unwrap();
    let turn = projection.turn(Uuid::from_u128(2)).unwrap();
    assert_eq!(turn.outcome, Some(TurnOutcome::Failed));
    assert!(
        turn.items
            .values()
            .all(|item| !item.accepted && item.text == "draft🙂")
    );
    assert_eq!(transport.requests.lock().unwrap().len(), 1);
}
