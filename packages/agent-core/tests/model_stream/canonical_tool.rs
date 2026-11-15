//! Codex ToolRouter builds payload arguments from OutputItemDone.
use super::*;

fn canonical(call_id: &str, name: &str, raw: &str) -> ModelStreamEvent {
    ModelStreamEvent::OutputItemDone(Box::new(CompletedModelItem {
        canonical_item_id: None,
        normalized: Some(ModelOutputItem::ToolCall(ToolCallIntent {
            call_id: call_id.into(),
            name: name.into(),
            raw_arguments_json: raw.into(),
            namespace: None,
        })),
        native: None,
    }))
}

#[test]
fn canonical_tool_arguments_replace_each_interleaved_draft_exactly() {
    let mut response = assembler();
    call(&mut response, "a");
    delta(&mut response, "a", r#"{"value":"draft"}"#);
    call(&mut response, "b");
    delta(&mut response, "b", r#"{"unfinished":"#);
    response
        .push(canonical("a", "read", r#" {"value":"done"} "#))
        .unwrap();
    // Empty/invalid canonical JSON is still an intent for the target's normal
    // parameter feedback. The assembler does not parse or repair arguments.
    response.push(canonical("b", "read", "")).unwrap();
    response
        .push(ModelStreamEvent::Completed {
            reason: FinishReason::ToolCalls,
            end_turn: None,
        })
        .unwrap();
    let result = response.finish().unwrap();
    assert_eq!(result.tool_calls.len(), 2);
    assert_eq!(result.tool_calls[0].call_id, "a");
    assert_eq!(
        result.tool_calls[0].raw_arguments_json,
        r#" {"value":"done"} "#
    );
    assert_eq!(result.tool_calls[1].call_id, "b");
    assert_eq!(result.tool_calls[1].raw_arguments_json, "");
    let completed = &result.output;
    assert!(
        matches!(&completed[0], ModelOutputItem::ToolCall(call) if call.raw_arguments_json == r#" {"value":"done"} "#)
    );
    assert!(
        matches!(&completed[1], ModelOutputItem::ToolCall(call) if call.raw_arguments_json.is_empty())
    );
}

#[test]
fn canonical_tool_correction_keeps_budget_identity_and_closed_call_boundaries() {
    let mut response = assembler();
    call(&mut response, "a");
    delta(&mut response, "a", "{}");
    assert_eq!(
        response.push(canonical("a", "read", &"x".repeat(129))),
        Err(ModelError::BudgetExceeded)
    );
    let mut response = assembler();
    call(&mut response, "a");
    delta(&mut response, "a", "{}");
    assert_eq!(
        response.push(canonical("a", "", "{}")),
        Err(ModelError::InvalidStream)
    );
    for late in [
        canonical("a", "read", "{}"),
        ModelStreamEvent::ToolArgumentsDelta {
            call_id: "a".into(),
            delta: "late".into(),
        },
    ] {
        let mut response = assembler();
        call(&mut response, "a");
        delta(&mut response, "a", r#"{"draft":true}"#);
        response.push(canonical("a", "read", "{}")).unwrap();
        assert_eq!(response.push(late), Err(ModelError::InvalidStream));
    }
}

#[test]
fn canonical_done_owns_name_and_namespace_without_reopening_a_call() {
    let mut response = assembler();
    call(&mut response, "a");
    delta(&mut response, "a", r#"{"draft":true}"#);
    let mut event = canonical("a", "write", r#"{"final":true}"#);
    let ModelStreamEvent::OutputItemDone(item) = &mut event else {
        unreachable!()
    };
    let Some(ModelOutputItem::ToolCall(call)) = &mut item.normalized else {
        unreachable!()
    };
    call.namespace = Some("foreign::".into());
    response.push(event).unwrap();
    response
        .push(ModelStreamEvent::Completed {
            reason: FinishReason::ToolCalls,
            end_turn: None,
        })
        .unwrap();
    let result = response.finish().unwrap();
    assert_eq!(result.tool_calls[0].call_id, "a");
    assert_eq!(result.tool_calls[0].name, "write");
    assert_eq!(result.tool_calls[0].namespace.as_deref(), Some("foreign::"));
    assert_eq!(result.tool_calls[0].raw_arguments_json, r#"{"final":true}"#);
}
