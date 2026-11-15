use super::{diagnostic_identifier, failure_priority, rejected_call};
use crate::model::{ContentPart, ModelMessage, ModelRequest, ToolCallIntent, ToolDefinition};
use crate::protocol::ModelIdentity;
use crate::runner::{RunError, ToolOutcomeDiagnostic};
#[test]
fn diagnostic_identifiers_are_bounded_and_do_not_embed_arbitrary_text() {
    assert_eq!(
        diagnostic_identifier("research_read_file"),
        "research_read_file"
    );
    for value in [
        "private body\nsecret",
        "{\"body\":\"secret\"}",
        &"a".repeat(129),
        "",
    ] {
        assert_eq!(diagnostic_identifier(value), "<invalid identifier>");
    }
}

#[test]
fn rejection_reports_exact_qualified_identity_without_exposing_unsafe_names() {
    let request = ModelRequest {
        request_id: uuid::Uuid::from_u128(1),
        model: ModelIdentity {
            provider_id: "provider".into(),
            model_id: "model".into(),
            revision: None,
        },
        messages: vec![ModelMessage::User {
            content: vec![ContentPart::Text("input".into())],
            source_item_id: None,
        }],
        tools: vec![ToolDefinition {
            namespace: Some("source_a".into()),
            name: "read".into(),
            description: "read".into(),
            parameters: serde_json::json!({}),
        }],
        max_output_tokens: 10,
        parallel_tool_calls: false,
        reasoning_effort: None,
        captured_history: None,
    };
    let mut call = ToolCallIntent {
        call_id: "call".into(),
        namespace: Some("source_b".into()),
        name: "read".into(),
        raw_arguments_json: "{}".into(),
    };
    let diagnostic = |call: &ToolCallIntent| match rejected_call(call, &request, "rejected", 0) {
        RunError::ToolRejectionDiagnostic(value) => {
            serde_json::from_str::<serde_json::Value>(&value).unwrap()
        }
        _ => unreachable!(),
    };
    assert_eq!(diagnostic(&call)["advertised"], false);
    assert_eq!(diagnostic(&call)["toolNamespace"], "source_b");
    call.namespace = Some("source_a".into());
    assert_eq!(diagnostic(&call)["advertised"], true);
    call.namespace = Some("private\nsecret".into());
    assert_eq!(diagnostic(&call)["toolNamespace"], "<invalid identifier>");
    assert!(!diagnostic(&call).to_string().contains("secret"));
    call.namespace = None;
    assert_eq!(diagnostic(&call)["advertised"], false);
    assert!(diagnostic(&call).get("toolNamespace").is_none());
}
#[test]
fn detailed_unknown_retains_the_original_recovery_priority() {
    let diagnostic = ToolOutcomeDiagnostic::try_from_value(serde_json::json!({
        "code":"TEXT_PATCH_JOURNAL_UNCONFIRMED","phase":"target-terminal","safeCause":"journal_sql_failed",
    })).unwrap();
    let detailed = RunError::ToolOutcomeUnknownDiagnostic(Box::new(diagnostic));
    let receipt = match &detailed {
        RunError::ToolOutcomeUnknownDiagnostic(detail) => {
            RunError::EventSinkDiagnostic(detail.clone())
        }
        _ => unreachable!(),
    };
    assert!(failure_priority(&detailed) > failure_priority(&RunError::ToolOutcomeUnknown));
    assert!(failure_priority(&detailed) > failure_priority(&RunError::ToolUnavailable));
    assert!(failure_priority(&detailed) < failure_priority(&RunError::EventSink));
    assert!(failure_priority(&receipt) > failure_priority(&detailed));
    assert!(receipt.is_event_sink());
    assert_eq!(
        receipt.failure_category(),
        crate::protocol::FailureCategory::Persistence
    );
    assert_eq!(
        detailed.failure_category(),
        RunError::ToolOutcomeUnknown.failure_category()
    );
    assert_eq!(
        RunError::ToolOutcomeUnknown.to_string(),
        "tool_outcome_unknown: tool execution outcome requires recovery"
    );
}
