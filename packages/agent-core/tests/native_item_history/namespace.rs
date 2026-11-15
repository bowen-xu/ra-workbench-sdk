use super::*;
use research_agent_core::{
    context::{
        accounting::{ContextTokenEstimator, Utf8JsonTokenEstimator},
        checkpoint::{restore_messages, store_messages},
    },
    conversation::{ConversationExport, ConversationId, ConversationSummary},
};
use serde_json::Value;

fn intent(namespace: Option<String>) -> ToolCallIntent {
    ToolCallIntent {
        call_id: "call".into(),
        name: "research_list_sources".into(),
        raw_arguments_json: "{".into(),
        namespace,
    }
}

#[test]
fn namespace_missing_and_null_keep_legacy_bytes_but_empty_is_a_distinct_fact() {
    let legacy = json!({"callId":"call","name":"research_list_sources","rawArgumentsJson":"{"});
    let absent: ToolCallIntent = serde_json::from_value(legacy.clone()).unwrap();
    assert_eq!(serde_json::to_value(&absent).unwrap(), legacy);
    let mut explicit_null = legacy.clone();
    explicit_null["namespace"] = Value::Null;
    assert_eq!(
        serde_json::from_value::<ToolCallIntent>(explicit_null).unwrap(),
        absent
    );
    let mut empty = legacy;
    empty["namespace"] = json!("");
    let empty: ToolCallIntent = serde_json::from_value(empty).unwrap();
    assert_eq!(empty.namespace, Some(String::new()));
    assert!(matches!(empty.parse(), Err(ToolCallParseError::Json(_))));
    assert!(matches!(absent.parse(), Err(ToolCallParseError::Json(_))));
}

#[test]
fn done_checkpoint_request_and_estimator_preserve_namespace_without_a_short_name_cap() {
    let estimate = |namespace| {
        let item = complete(Some(ModelOutputItem::ToolCall(intent(namespace))), None);
        let mut stream = assembler();
        let event = done(item.clone());
        stream.push(event.clone()).unwrap();
        assert_eq!(stream.completed_item(&event).unwrap(), Some(item.clone()));
        stream
            .push(ModelStreamEvent::Completed {
                reason: FinishReason::ToolCalls,
                end_turn: None,
            })
            .unwrap();
        let response = stream.finish().unwrap();
        assert_eq!(response.output, [item.normalized.clone().unwrap()]);
        assert_eq!(
            response.tool_calls,
            [match item.normalized.clone().unwrap() {
                ModelOutputItem::ToolCall(call) => call,
                _ => unreachable!(),
            }]
        );
        let messages = vec![
            ModelMessage::CanonicalOutput(Box::new(item)),
            ModelMessage::ToolResult {
                call_id: "call".into(),
                content: "unsupported".into(),
                is_error: true,
            },
        ];
        let stored = store_messages(&messages).unwrap();
        let restored = restore_messages(&stored, &|_| None).unwrap();
        assert!(restored == messages);
        Utf8JsonTokenEstimator.estimate(&restored, &[]).unwrap()
    };
    assert!(estimate(Some(String::new())) > estimate(None));
    assert!(estimate(Some("命名🦀".repeat(100))) > estimate(Some("foreign::".into())));
}

#[test]
fn shared_namespace_golden_replays_and_exports_the_same_complete_facts() {
    let fixture: Value = serde_json::from_str(include_str!(
        "../../../../tests/fixtures/agent-tool-namespace-v1.json"
    ))
    .unwrap();
    let events: Vec<AgentEvent> = serde_json::from_value(fixture.clone()).unwrap();
    assert_eq!(serde_json::to_value(&events).unwrap(), fixture);
    let id = ConversationId::from_uuid(Uuid::from_u128(1));
    let mut projection = ConversationProjection::new(id);
    for event in &events {
        projection.apply(event).unwrap();
    }
    let history = reconstruct_history(&projection).unwrap();
    let namespaces = history
        .iter()
        .filter_map(|message| match message {
            ModelMessage::CanonicalOutput(item) => match &item.normalized {
                Some(ModelOutputItem::ToolCall(call)) => Some(call.namespace.clone()),
                _ => None,
            },
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(
        namespaces,
        vec![
            Some("foreign::".into()),
            Some(String::new()),
            Some("命名🦀".repeat(100))
        ]
    );
    let export = ConversationExport::from_projection(
        ConversationSummary {
            id,
            title: "Namespace facts".into(),
            internal: false,
            archived: false,
            durable_count: events.len() as u64,
            created_at: "2026-10-26T00:00:00.000Z".into(),
            updated_at: "2026-10-26T00:00:00.000Z".into(),
        },
        &projection,
    )
    .unwrap();
    let value = serde_json::to_value(export).unwrap();
    for (index, namespace) in namespaces.iter().enumerate() {
        assert_eq!(
            value["turns"][0]["items"][index * 2]["kind"]["namespace"],
            json!(namespace)
        );
        assert!(
            value["turns"][0]["items"][index * 2]["kind"]
                .get("providerCallId")
                .is_none()
        );
    }
}

#[test]
fn namespace_stays_inside_existing_item_response_and_event_metadata_budgets() {
    let oversized = complete(
        Some(ModelOutputItem::ToolCall(intent(Some(
            "n".repeat(MAX_NATIVE_ITEM_BYTES),
        )))),
        None,
    );
    assert_eq!(oversized.validate(), Err(ModelError::BudgetExceeded));
    let mut stream = assembler();
    let first = complete(
        Some(ModelOutputItem::ToolCall(intent(Some(
            "n".repeat(MAX_NATIVE_ITEM_BYTES / 2),
        )))),
        None,
    );
    stream.push(done(first)).unwrap();
    let mut second = intent(Some("n".repeat(MAX_NATIVE_ITEM_BYTES / 2)));
    second.call_id = "next".into();
    assert_eq!(
        stream.push(done(complete(
            Some(ModelOutputItem::ToolCall(second)),
            None
        ))),
        Err(ModelError::BudgetExceeded)
    );
    let payload = EventPayload::ItemAccepted {
        turn_id: Uuid::from_u128(2),
        item_id: Uuid::from_u128(10),
        kind: ItemKind::ToolCall {
            call_id: Uuid::from_u128(20),
            name: "read".into(),
            provider_call_id: None,
            namespace: Some("n".repeat(MAX_NATIVE_ITEM_BYTES)),
        },
        text: "{".into(),
        phase: None,
        source: None,
    };
    assert!(
        AgentEvent::new(
            ConversationId::from_uuid(Uuid::from_u128(1)),
            1,
            0,
            Uuid::from_u128(4),
            payload
        )
        .is_err()
    );
    let mut combined = complete(
        Some(ModelOutputItem::ToolCall(intent(Some("n".repeat(1024))))),
        Some(native("function_call", "fc")),
    );
    combined.native.as_mut().unwrap().data =
        json!({"padding":"n".repeat(MAX_NATIVE_ITEM_BYTES-700)});
    assert!(combined.native.as_ref().unwrap().validate().is_ok());
    assert_eq!(combined.validate(), Err(ModelError::BudgetExceeded));
}
