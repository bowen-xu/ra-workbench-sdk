use super::*;
use research_agent_core::context::{
    accounting::{ContextTokenEstimator, Utf8JsonTokenEstimator},
    checkpoint::{StoredMessage, restore_messages, store_messages},
    compaction::compact_history,
};

#[test]
fn completed_intents_keep_every_raw_string_through_checkpoint_request_and_accounting() {
    for raw in ["", "{", "[1,2]", "null", "17", "\"text\"", " {\n\"q\":1 } "] {
        let mut stream = assembler();
        let item = complete(
            Some(ModelOutputItem::ToolCall(ToolCallIntent {
                call_id: "call".into(),
                name: "read".into(),
                raw_arguments_json: raw.into(),
                namespace: None,
            })),
            None,
        );
        let event = done(item.clone());
        stream.push(event.clone()).unwrap();
        assert_eq!(stream.completed_item(&event).unwrap(), Some(item.clone()));
        stream
            .push(ModelStreamEvent::Completed {
                reason: FinishReason::ToolCalls,
                end_turn: None,
            })
            .unwrap();
        assert_eq!(
            stream.finish().unwrap().tool_calls[0].raw_arguments_json,
            raw
        );
        let messages = vec![
            ModelMessage::User {
                content: vec![ContentPart::Text("question".into())],
                source_item_id: None,
            },
            ModelMessage::CanonicalOutput(Box::new(item)),
            ModelMessage::ToolResult {
                call_id: "call".into(),
                content: "parameter feedback".into(),
                is_error: true,
            },
        ];
        let stored = store_messages(&messages).unwrap();
        let json = serde_json::to_value(&stored).unwrap();
        assert!(json[1]["item"]["normalized"].get("arguments").is_none());
        assert_eq!(json[1]["item"]["normalized"]["rawArgumentsJson"], raw);
        let stored: Vec<StoredMessage> = serde_json::from_value(json).unwrap();
        let restored = restore_messages(&stored, &|_| None).unwrap();
        assert!(restored == messages);
        let request = ModelRequest {
            request_id: Uuid::from_u128(1),
            model: model(),
            messages: restored,
            tools: vec![],
            max_output_tokens: 1,
            parallel_tool_calls: false,
            reasoning_effort: None,
            captured_history: None,
        };
        request
            .validate(ModelCapabilities {
                vision: false,
                tools: true,
                parallel_tools: false,
                reasoning_efforts: vec![],
            })
            .unwrap();
        assert!(
            Utf8JsonTokenEstimator
                .estimate(&request.messages, &[])
                .is_some()
        );
        assert!(compact_history(&request.messages, 65536, 65536).is_ok());
    }
}

#[test]
fn old_double_copy_checkpoints_require_consistent_parameters_and_new_raw_is_authoritative() {
    let old = json!({"callId":"call","name":"read","arguments":{"x":1},"rawArgumentsJson":" { \"x\" : 1 } "});
    let decoded: ToolCallIntent = serde_json::from_value(old.clone()).unwrap();
    assert_eq!(decoded.raw_arguments_json, " { \"x\" : 1 } ");
    let mut different = old;
    different["rawArgumentsJson"] = json!("{\"x\":2}");
    assert!(serde_json::from_value::<ToolCallIntent>(different).is_err());
    for (arguments, raw) in [(json!(null), "{}"), (json!({}), "{"), (json!({}), "")] {
        assert!(
            serde_json::from_value::<ToolCallIntent>(json!({
                "callId":"call","name":"read","arguments":arguments,"rawArgumentsJson":raw
            }))
            .is_err()
        );
    }
    let no_raw: ToolCallIntent =
        serde_json::from_value(json!({"callId":"call","name":"read","arguments":{"x":1}})).unwrap();
    assert_eq!(no_raw.raw_arguments_json, "{\"x\":1}");
    assert!(
        serde_json::from_value::<ToolCallIntent>(json!({"callId":"call","name":"read"})).is_err()
    );
}

#[test]
fn raw_arguments_keep_capacity_limits_and_canonical_done_replaces_partial_drafts() {
    let mut stream = assembler();
    let item = |raw: String| {
        done(complete(
            Some(ModelOutputItem::ToolCall(ToolCallIntent {
                call_id: "call".into(),
                name: "read".into(),
                raw_arguments_json: raw,
                namespace: None,
            })),
            None,
        ))
    };
    assert_eq!(
        stream.push(item("{".repeat(65537))),
        Err(ModelError::BudgetExceeded)
    );
    let draft = || {
        let mut stream = assembler();
        stream
            .push(ModelStreamEvent::ToolCallStarted {
                call_id: "call".into(),
                name: "read".into(),
            })
            .unwrap();
        stream
            .push(ModelStreamEvent::ToolArgumentsDelta {
                call_id: "call".into(),
                delta: "{\"x\":".into(),
            })
            .unwrap();
        stream
    };
    assert_eq!(
        draft().push(item("{".repeat(65537))),
        Err(ModelError::BudgetExceeded)
    );
    for raw in ["[1]", "{", "", " {\"x\":2} "] {
        let mut stream = draft();
        stream.push(item(raw.into())).unwrap();
        stream
            .push(ModelStreamEvent::Completed {
                reason: FinishReason::ToolCalls,
                end_turn: None,
            })
            .unwrap();
        let calls = stream.finish().unwrap().tool_calls;
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].raw_arguments_json, raw);
    }
    // Legacy completion has no replacement payload and retains the draft,
    // including malformed JSON for the existing runner feedback path.
    let mut stream = draft();
    stream
        .push(ModelStreamEvent::ToolCallCompleted {
            call_id: "call".into(),
        })
        .unwrap();
    stream
        .push(ModelStreamEvent::Completed {
            reason: FinishReason::ToolCalls,
            end_turn: None,
        })
        .unwrap();
    let calls = stream.finish().unwrap().tool_calls;
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].name, "read");
    assert_eq!(calls[0].namespace, None);
    assert_eq!(calls[0].raw_arguments_json, "{\"x\":");
}

#[test]
fn tool_name_and_provider_call_identity_obey_the_existing_event_character_capacity() {
    for (call_id, name) in [
        ("id".into(), "x".repeat(MAX_EVENT_NAME_CHARS + 1)),
        ("i".repeat(MAX_EVENT_NAME_CHARS + 1), "read".into()),
    ] {
        let item = complete(
            Some(ModelOutputItem::ToolCall(ToolCallIntent {
                call_id: call_id.clone(),
                name: name.clone(),
                raw_arguments_json: "{}".into(),
                namespace: None,
            })),
            None,
        );
        assert_eq!(item.validate(), Err(ModelError::BudgetExceeded));
        assert_eq!(
            assembler().push(done(item)),
            Err(ModelError::BudgetExceeded)
        );
        assert_eq!(
            assembler().push(ModelStreamEvent::ToolCallStarted { call_id, name }),
            Err(ModelError::BudgetExceeded)
        );
    }
    // The existing wire contract counts characters, not UTF-8 bytes.
    let name = "🦀".repeat(MAX_EVENT_NAME_CHARS);
    let mut stream = assembler();
    stream
        .push(done(complete(
            Some(ModelOutputItem::ToolCall(ToolCallIntent {
                call_id: "id".into(),
                name,
                raw_arguments_json: "{".into(),
                namespace: None,
            })),
            None,
        )))
        .unwrap();
}
