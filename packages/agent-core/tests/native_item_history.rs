use research_agent_core::{model::*, protocol::*};
use serde_json::json;
use uuid::Uuid;

#[path = "native_item_history/accounting.rs"]
mod accounting;
#[path = "native_item_history/captured.rs"]
mod captured;
#[path = "native_item_history/namespace.rs"]
mod namespace;
#[path = "native_item_history/projection.rs"]
mod projection;
#[path = "native_item_history/raw_arguments.rs"]
mod raw_arguments;
#[path = "native_item_history/runner.rs"]
mod runner;

fn model() -> ModelIdentity {
    ModelIdentity {
        provider_id: "fixture".into(),
        model_id: "native".into(),
        revision: Some("v1".into()),
    }
}
fn native(kind: &str, id: &str) -> NativeItemData {
    let mut data = NativeItemData::new(
        "responses".into(),
        model(),
        kind.into(),
        json!({"item":{"type":kind,"encrypted_content":"opaque-signature"}}),
    );
    data.account_scope = Some(Uuid::from_u128(8));
    data.item_id = Some(id.into());
    data.response_id = Some("response".into());
    data
}
fn done(item: CompletedModelItem) -> ModelStreamEvent {
    ModelStreamEvent::OutputItemDone(Box::new(item))
}
fn complete(
    normalized: Option<ModelOutputItem>,
    native: Option<NativeItemData>,
) -> CompletedModelItem {
    CompletedModelItem {
        canonical_item_id: None,
        normalized,
        native: native.map(Box::new),
    }
}
fn assembler() -> ResponseAssembler {
    let mut value = ResponseAssembler::new(StreamLimits {
        text_bytes: 65536,
        argument_bytes: 65536,
        tool_calls: 8,
    })
    .unwrap()
    .with_requested_model(model());
    value
        .push(ModelStreamEvent::StartedWithoutModel {
            response_id: "response".into(),
        })
        .unwrap();
    value
}

#[test]
fn native_envelope_roundtrips_unknown_fields_and_never_debugs_opaque_material() {
    let mut value = native("reasoning", "r");
    value
        .extra
        .insert("future".into(), json!({"signature":"other-opaque"}));
    let text = value.to_json().unwrap();
    assert_eq!(NativeItemData::from_json(&text).unwrap(), value);
    let debug = format!("{value:?}");
    assert!(!debug.contains("opaque-signature"));
    assert!(!debug.contains("other-opaque"));
    let source = CanonicalItemSource {
        attempt_id: Uuid::from_u128(3),
        ordinal: 0,
        provider_item_id: Some("r".into()),
        provider_data_json: Some(text),
    };
    assert!(!format!("{source:?}").contains("opaque-signature"));
    value.schema_version = 2;
    assert_eq!(value.validate(), Err(NativeItemError::UnsupportedVersion));
    value.schema_version = 1;
    value.data = json!({"payload":"x".repeat(MAX_NATIVE_ITEM_BYTES)});
    assert_eq!(value.validate(), Err(NativeItemError::ByteLimit));
}

#[test]
fn done_items_preserve_native_only_order_raw_arguments_and_sparse_message_suffix() {
    let mut value = assembler();
    let reasoning = done(complete(None, Some(native("reasoning", "r"))));
    value.push(reasoning.clone()).unwrap();
    assert!(
        value
            .completed_item(&reasoning)
            .unwrap()
            .unwrap()
            .normalized
            .is_none()
    );
    value
        .push(ModelStreamEvent::AssistantMessageStarted {
            item_id: "m".into(),
            phase: Some(AssistantMessagePhase::FinalAnswer),
        })
        .unwrap();
    value
        .push(ModelStreamEvent::AssistantTextDelta {
            item_id: "m".into(),
            text: "你".into(),
        })
        .unwrap();
    let message = done(complete(
        Some(ModelOutputItem::Message(AssistantMessage {
            item_id: "m".into(),
            text: "你🙂\0tail".into(),
            phase: None,
        })),
        Some(native("message", "m")),
    ));
    value.push(message.clone()).unwrap();
    assert!(
        matches!(value.completed_item(&message).unwrap().unwrap().normalized,
        Some(ModelOutputItem::Message(message)) if message.phase==Some(AssistantMessagePhase::FinalAnswer) && message.text=="你🙂\0tail")
    );
    let raw = "{\n  \"q\": 1\n}";
    let call = done(complete(
        Some(ModelOutputItem::ToolCall(ToolCallIntent {
            call_id: "c".into(),
            name: "read".into(),
            raw_arguments_json: raw.into(),
            namespace: None,
        })),
        Some(native("function_call", "fc")),
    ));
    value.push(call).unwrap();
    assert_eq!(value.completed_items().len(), 3);
    value
        .push(ModelStreamEvent::Completed {
            reason: FinishReason::ToolCalls,
            end_turn: Some(true),
        })
        .unwrap();
    let response = value.finish().unwrap();
    assert_eq!(response.output.len(), 2);
    assert_eq!(response.tool_calls[0].raw_arguments_json, raw);
    assert_eq!(response.text, "你🙂\0tail");
    assert!(!response.actual_model_observed);
}

#[test]
fn native_duplicate_and_function_calls_without_normalized_intent_are_rejected() {
    let native_only = complete(None, Some(native("reasoning", "r")));
    let mut value = assembler();
    value.push(done(native_only.clone())).unwrap();
    assert_eq!(
        value.push(done(native_only)),
        Err(ModelError::InvalidStream)
    );
    assert!(value.finish().is_err());
    for kind in ["message", "function_call"] {
        assert_eq!(
            complete(None, Some(native(kind, "x"))).validate(),
            Err(ModelError::InvalidStream)
        );
    }
    let call = ToolCall {
        namespace: None,
        call_id: "c".into(),
        name: "read".into(),
        arguments: json!({"q":1}),
        raw_arguments_json: Some("{\"q\":2}".into()),
    };
    assert_eq!(call.arguments_json(), Err(ModelError::InvalidStream));
}

#[test]
fn provider_native_events_require_complete_matching_extension_and_have_no_draft_route() {
    use research_agent_core::conversation::ConversationId;
    let id = ConversationId::from_uuid(Uuid::from_u128(1));
    let source = CanonicalItemSource {
        attempt_id: Uuid::from_u128(3),
        ordinal: 0,
        provider_item_id: Some("r".into()),
        provider_data_json: Some(native("reasoning", "r").to_json().unwrap()),
    };
    let event = |kind, text: &str, phase, source| {
        AgentEvent::new(
            id,
            1,
            0,
            Uuid::from_u128(2),
            EventPayload::ItemAccepted {
                turn_id: Uuid::from_u128(2),
                item_id: Uuid::from_u128(5),
                kind,
                text: text.into(),
                phase,
                source,
            },
        )
    };
    assert!(
        event(
            ItemKind::ProviderNative {
                item_type: "reasoning".into()
            },
            "",
            None,
            Some(source.clone())
        )
        .is_ok()
    );
    assert!(
        event(
            ItemKind::ProviderNative {
                item_type: "reasoning".into()
            },
            "fake text",
            None,
            Some(source.clone())
        )
        .is_err()
    );
    assert!(
        event(
            ItemKind::ProviderNative {
                item_type: "reasoning".into()
            },
            "",
            None,
            None
        )
        .is_err()
    );
    assert!(
        event(
            ItemKind::ProviderNative {
                item_type: "other".into()
            },
            "",
            None,
            Some(source)
        )
        .is_err()
    );
    assert!(
        AgentEvent::new(
            id,
            1,
            0,
            Uuid::from_u128(2),
            EventPayload::ItemStarted {
                turn_id: Uuid::from_u128(2),
                item_id: Uuid::from_u128(5),
                kind: ItemKind::ProviderNative {
                    item_type: "reasoning".into()
                }
            }
        )
        .is_err()
    );
}

#[test]
fn canonical_context_roundtrip_retains_exact_arguments_native_data_and_user_origin() {
    use research_agent_core::context::checkpoint::{
        StoredMessage, restore_messages, store_messages,
    };
    let user = Uuid::from_u128(10);
    let raw = "{ \"q\" : 1 }";
    let mut item = complete(
        Some(ModelOutputItem::ToolCall(ToolCallIntent {
            call_id: "c".into(),
            name: "read".into(),
            raw_arguments_json: raw.into(),
            namespace: None,
        })),
        Some(native("function_call", "fc")),
    );
    item.canonical_item_id = Some(Uuid::from_u128(11));
    let messages = vec![
        ModelMessage::User {
            content: vec![ContentPart::Text("question".into())],
            source_item_id: Some(user),
        },
        ModelMessage::CanonicalOutput(Box::new(item)),
        ModelMessage::ToolResult {
            call_id: "c".into(),
            content: "result".into(),
            is_error: false,
        },
    ];
    let stored = store_messages(&messages).unwrap();
    let encoded = serde_json::to_string(&stored).unwrap();
    let decoded: Vec<StoredMessage> = serde_json::from_str(&encoded).unwrap();
    assert!(restore_messages(&decoded, &|_| None).unwrap() == messages);
    let legacy: StoredMessage =
        serde_json::from_value(json!({"role":"user","content":[{"type":"text","text":"legacy"}]}))
            .unwrap();
    assert!(matches!(
        legacy,
        StoredMessage::User {
            source_item_id: None,
            ..
        }
    ));
    let accounting = research_agent_core::context::accounting::Utf8JsonTokenEstimator;
    use research_agent_core::context::accounting::ContextTokenEstimator;
    assert_eq!(
        accounting.estimate(&messages, &[]),
        None,
        "opaque is unknown, not zero"
    );
}
