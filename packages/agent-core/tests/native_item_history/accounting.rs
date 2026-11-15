use super::*;
use research_agent_core::context::{
    accounting::{ContextTokenEstimator, Utf8JsonTokenEstimator},
    compaction::compact_history,
};

fn legacy(raw: Option<String>) -> Vec<ModelMessage> {
    vec![
        ModelMessage::User {
            content: vec![ContentPart::Text("question".into())],
            source_item_id: None,
        },
        ModelMessage::Assistant {
            content: vec![],
            phase: None,
            tool_calls: vec![ToolCall {
                namespace: None,
                call_id: "call".into(),
                name: "read".into(),
                arguments: json!({"q":1}),
                raw_arguments_json: raw,
            }],
        },
        ModelMessage::ToolResult {
            call_id: "call".into(),
            content: "done".into(),
            is_error: false,
        },
    ]
}

#[test]
fn legacy_raw_arguments_are_measured_and_invalid_raw_intent_is_unknown() {
    let estimator = Utf8JsonTokenEstimator;
    let plain = estimator.estimate(&legacy(None), &[]).unwrap();
    let raw = format!("{{{}\"q\":1}}", " ".repeat(1024));
    let exact_messages = legacy(Some(raw));
    let exact = estimator.estimate(&exact_messages, &[]).unwrap();
    assert_eq!(exact - plain, 256);
    assert!(compact_history(&legacy(None), 512, 512).is_ok());
    assert!(compact_history(&exact_messages, 512, 512).is_err());
    assert_eq!(
        estimator.estimate(&legacy(Some("{\"q\":2}".into())), &[]),
        None
    );
}

#[test]
fn legacy_raw_whitespace_participates_in_history_hash() {
    let plain = legacy(None);
    let compact = legacy(Some("{\"q\":1}".into()));
    let spaced = legacy(Some("{\n \"q\" : 1\n}".into()));
    let hash = |history: &[ModelMessage]| {
        compact_history(history, 65536, 65536)
            .unwrap()
            .record
            .history_sha256
    };
    assert_ne!(hash(&compact), hash(&spaced));
    assert_ne!(hash(&plain), hash(&compact));
    assert_eq!(hash(&plain), hash(&legacy(None)));
}

#[test]
fn parsed_call_namespace_survives_checkpoint_and_changes_accounting_and_identity() {
    use research_agent_core::context::checkpoint::{restore_messages, store_messages};
    let plain = legacy(None);
    let mut namespaced = plain.clone();
    let ModelMessage::Assistant { tool_calls, .. } = &mut namespaced[1] else {
        panic!("expected assistant message");
    };
    tool_calls[0].namespace = Some("命名🦀".repeat(100));
    let intent = ToolCallIntent::try_from(&tool_calls[0]).unwrap();
    assert_eq!(intent.namespace, tool_calls[0].namespace);
    let stored = store_messages(&namespaced).unwrap();
    let restored = restore_messages(&stored, &|_| None).unwrap();
    assert!(restored == namespaced);
    let plain_stored = store_messages(&plain).unwrap();
    let encoded = serde_json::to_string(&plain_stored).unwrap();
    assert!(!encoded.contains("namespace"));
    assert!(
        restore_messages(&serde_json::from_str::<Vec<_>>(&encoded).unwrap(), &|_| {
            None
        })
        .unwrap()
            == plain
    );
    let estimator = Utf8JsonTokenEstimator;
    assert!(
        estimator.estimate(&namespaced, &[]).unwrap() > estimator.estimate(&plain, &[]).unwrap()
    );
    let hash = |history: &[ModelMessage]| {
        compact_history(history, 65536, 65536)
            .unwrap()
            .record
            .history_sha256
    };
    assert_ne!(hash(&plain), hash(&namespaced));
}
