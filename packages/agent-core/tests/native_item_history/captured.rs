use super::*;

fn request() -> ModelRequest {
    ModelRequest {
        request_id: Uuid::from_u128(1),
        model: model(),
        messages: vec![ModelMessage::User {
            content: vec![ContentPart::Text("question".into())],
            source_item_id: Some(Uuid::from_u128(10)),
        }],
        tools: vec![],
        max_output_tokens: 100,
        parallel_tool_calls: false,
        reasoning_effort: None,
        captured_history: Some(CapturedHistoryRef {
            conversation_id: Uuid::from_u128(2),
            through_seq: 8,
            after_seq: 4,
            turns: vec![CapturedTurnRef {
                turn_id: Uuid::from_u128(3),
                user_item_ids: vec![Uuid::from_u128(10)],
            }],
        }),
    }
}
fn capabilities() -> ModelCapabilities {
    ModelCapabilities {
        vision: false,
        tools: true,
        parallel_tools: false,
        reasoning_efforts: vec![],
    }
}

#[test]
fn captured_history_rejects_invalid_ranges_nil_or_repeated_fact_identities() {
    let baseline = request();
    baseline.validate(capabilities()).unwrap();
    let original = baseline.captured_history.unwrap();
    let mut invalid = vec![];
    let mut value = original.clone();
    value.after_seq = 9;
    invalid.push(value);
    let mut value = original.clone();
    value.through_seq = 9_007_199_254_740_992;
    invalid.push(value);
    let mut value = original.clone();
    value.conversation_id = Uuid::nil();
    invalid.push(value);
    let mut value = original.clone();
    value.turns[0].turn_id = Uuid::nil();
    invalid.push(value);
    let mut value = original.clone();
    value.turns.push(value.turns[0].clone());
    invalid.push(value);
    let mut value = original.clone();
    value.turns[0].user_item_ids.push(Uuid::nil());
    invalid.push(value);
    let mut value = original.clone();
    value.turns[0].user_item_ids.push(Uuid::from_u128(10));
    invalid.push(value);
    let mut value = original.clone();
    value.turns.push(CapturedTurnRef {
        turn_id: Uuid::from_u128(5),
        user_item_ids: vec![Uuid::from_u128(10)],
    });
    invalid.push(value);
    for captured in invalid {
        let mut current = request();
        current.captured_history = Some(captured);
        assert_eq!(
            current.validate(capabilities()),
            Err(ModelError::InvalidRequest)
        );
    }
}

#[test]
fn canonical_tool_intents_keep_pairing_barriers_across_native_only_items() {
    let mut value = request();
    let call = complete(
        Some(ModelOutputItem::ToolCall(ToolCallIntent {
            call_id: "call".into(),
            name: "read".into(),
            raw_arguments_json: "{}".into(),
            namespace: None,
        })),
        Some(native("function_call", "fc")),
    );
    value
        .messages
        .push(ModelMessage::CanonicalOutput(Box::new(call.clone())));
    value
        .messages
        .push(ModelMessage::CanonicalOutput(Box::new(complete(
            None,
            Some(native("reasoning", "r")),
        ))));
    assert_eq!(
        value.validate(capabilities()),
        Err(ModelError::InvalidRequest)
    );
    value.messages.push(ModelMessage::ToolResult {
        call_id: "other".into(),
        content: "done".into(),
        is_error: false,
    });
    assert_eq!(
        value.validate(capabilities()),
        Err(ModelError::InvalidRequest)
    );
    *value.messages.last_mut().unwrap() = ModelMessage::ToolResult {
        call_id: "call".into(),
        content: "done".into(),
        is_error: false,
    };
    value.validate(capabilities()).unwrap();
    value
        .messages
        .push(ModelMessage::CanonicalOutput(Box::new(call)));
    value.messages.push(ModelMessage::ToolResult {
        call_id: "call".into(),
        content: "again".into(),
        is_error: false,
    });
    assert_eq!(
        value.validate(capabilities()),
        Err(ModelError::InvalidRequest)
    );
}
