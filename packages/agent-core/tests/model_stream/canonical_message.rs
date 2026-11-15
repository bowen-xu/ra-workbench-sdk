use super::*;
use research_agent_core::protocol::AssistantMessagePhase;

fn done_message(id: &str, text: &str) -> ModelStreamEvent {
    ModelStreamEvent::OutputItemDone(Box::new(CompletedModelItem {
        canonical_item_id: None,
        normalized: Some(ModelOutputItem::Message(AssistantMessage {
            item_id: id.into(),
            text: text.into(),
            phase: Some(AssistantMessagePhase::FinalAnswer),
        })),
        native: None,
    }))
}

fn draft(response: &mut ResponseAssembler, id: &str, text: &str) {
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
}

#[test]
fn authoritative_done_replaces_interleaved_draft_bodies_and_known_phases() {
    let mut response = assembler();
    draft(&mut response, "a", "draft🙂");
    draft(&mut response, "b", "second");
    response
        .push(ModelStreamEvent::AssistantTextDelta {
            item_id: "a".into(),
            text: "tail".into(),
        })
        .unwrap();
    response.push(done_message("a", "corrected🧪")).unwrap();
    assert_eq!(response.partial_text(), "corrected🧪second");
    response.push(done_message("b", "")).unwrap();
    response
        .push(ModelStreamEvent::Completed {
            reason: FinishReason::Stop,
            end_turn: None,
        })
        .unwrap();
    let result = response.finish().unwrap();
    assert_eq!(result.text, "corrected🧪");
    assert!(
        matches!(&result.output[0], ModelOutputItem::Message(message) if message.item_id == "a" && message.text == "corrected🧪" && message.phase == Some(AssistantMessagePhase::FinalAnswer))
    );
    assert!(
        matches!(&result.output[1], ModelOutputItem::Message(message) if message.item_id == "b" && message.text.is_empty())
    );
}

#[test]
fn canonical_correction_keeps_body_budget_and_closed_item_protection() {
    let mut response = assembler();
    draft(&mut response, "a", "draft");
    assert_eq!(
        response.push(done_message("a", &"x".repeat(65))),
        Err(ModelError::BudgetExceeded)
    );
    let mut response = assembler();
    draft(&mut response, "a", "draft");
    response.push(done_message("a", "corrected")).unwrap();
    assert_eq!(
        response.push(done_message("a", "again")),
        Err(ModelError::InvalidStream)
    );
}
