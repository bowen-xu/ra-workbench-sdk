use super::*;
use research_agent_core::protocol::AssistantMessagePhase;

fn message(response: &mut ResponseAssembler, id: &str, text: &str) {
    response
        .push(ModelStreamEvent::AssistantMessageStarted {
            item_id: id.into(),
            phase: Some(AssistantMessagePhase::Commentary),
        })
        .unwrap();
    response
        .push(ModelStreamEvent::AssistantTextDelta {
            item_id: id.into(),
            text: text.into(),
        })
        .unwrap();
    response
        .push(ModelStreamEvent::AssistantMessageCompleted {
            item_id: id.into(),
            phase: None,
        })
        .unwrap();
}

#[test]
fn terminal_order_cannot_reorder_already_accepted_messages_or_calls() {
    let mut response = assembler();
    message(&mut response, "second", "B");
    call(&mut response, "b");
    delta(&mut response, "b", "{}");
    done(&mut response, "b");
    message(&mut response, "first", "A");
    call(&mut response, "a");
    delta(&mut response, "a", "{}");
    done(&mut response, "a");
    assert_eq!(
        response.push(ModelStreamEvent::OutputOrder(vec![
            ModelOutputItemId::Message("first".into()),
            ModelOutputItemId::ToolCall("a".into()),
            ModelOutputItemId::Message("second".into()),
            ModelOutputItemId::ToolCall("b".into()),
        ])),
        Err(ModelError::InvalidStream)
    );
    let items = response.completed_items();
    assert_eq!(
        items
            .iter()
            .filter_map(|item| match item.normalized.as_ref() {
                Some(ModelOutputItem::ToolCall(call)) => Some(call.call_id.as_str()),
                _ => None,
            })
            .collect::<Vec<_>>(),
        vec!["b", "a"]
    );
    assert!(
        matches!(items[0].normalized.as_ref(), Some(ModelOutputItem::Message(message)) if message.item_id == "second" && message.phase == Some(AssistantMessagePhase::Commentary))
    );
    assert!(response.finish().is_err());
}

#[test]
fn sparse_response_does_not_claim_the_requested_model_was_observed() {
    let mut response = ResponseAssembler::new(StreamLimits {
        text_bytes: 64,
        argument_bytes: 64,
        tool_calls: 1,
    })
    .unwrap()
    .with_requested_model(identity());
    response
        .push(ModelStreamEvent::StartedWithoutModel {
            response_id: "sparse".into(),
        })
        .unwrap();
    response
        .push(ModelStreamEvent::TextDelta("hello".into()))
        .unwrap();
    response
        .push(ModelStreamEvent::Completed {
            reason: FinishReason::Stop,
            end_turn: None,
        })
        .unwrap();
    let response = response.finish().unwrap();
    assert_eq!(response.actual_model, identity());
    assert!(!response.actual_model_observed);
}

#[test]
fn terminal_order_cannot_omit_duplicate_or_invent_an_observed_item() {
    for order in [
        vec![],
        vec![ModelOutputItemId::Message("unknown".into())],
        vec![
            ModelOutputItemId::Message("item".into()),
            ModelOutputItemId::Message("item".into()),
        ],
    ] {
        let mut response = assembler();
        message(&mut response, "item", "text");
        assert_eq!(
            response.push(ModelStreamEvent::OutputOrder(order)),
            Err(ModelError::InvalidStream)
        );
        assert!(response.finish().is_err());
    }
    let mut response = assembler();
    message(&mut response, "item", "text");
    response
        .push(ModelStreamEvent::OutputOrder(vec![
            ModelOutputItemId::Message("item".into()),
        ]))
        .unwrap();
    assert_eq!(
        response.push(ModelStreamEvent::AssistantMessageStarted {
            item_id: "late".into(),
            phase: None
        }),
        Err(ModelError::InvalidStream)
    );
}
