use super::*;
use crate::context::compaction_hooks::*;
use serde_json::json;

fn parse(stage: CompactionHookStage, output: &str) -> CompactionHookResult {
    CompactionHookResult::from_process_output(stage, Some(0), output, 4096)
}

#[test]
fn session_start_stop_preserves_context_for_later_turns() {
    let result = parse(
        CompactionHookStage::SessionStartCompact,
        &json!({"continue": false, "stopReason": "pause", "systemMessage": "diagnostic", "hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": "  exact context\n"}}).to_string(),
    );
    assert_eq!(result.outcome, CompactionHookOutcome::Stop);
    assert_eq!(result.additional_contexts, ["  exact context\n"]);
}

#[test]
fn plain_stdout_is_context_only_at_session_start() {
    let result = parse(CompactionHookStage::SessionStartCompact, "  研究规则\n ");
    assert_eq!(result.outcome, CompactionHookOutcome::Continue);
    assert_eq!(result.additional_contexts, ["研究规则"]);
    for stage in [
        CompactionHookStage::PreCompact,
        CompactionHookStage::PostCompact,
    ] {
        assert!(parse(stage, "plain stdout").additional_contexts.is_empty());
        let result = parse(
            stage,
            r#"{"continue":false,"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"not context here"}}"#,
        );
        assert_eq!(result.outcome, CompactionHookOutcome::Stop);
        assert!(result.additional_contexts.is_empty());
    }
}

#[test]
fn malformed_or_wrong_stage_structured_output_cannot_become_context() {
    for output in [
        "{invalid}",
        "[]",
        r#"{"continue":"false"}"#,
        r#"{"continue":null}"#,
        "[null,null,null,null,null]",
        r#"{"hookSpecificOutput":{"additionalContext":"missing event"}}"#,
        r#"{"hookSpecificOutput":{"hookEventName":"PostCompact","additionalContext":"wrong event"}}"#,
        r#"{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":1}}"#,
    ] {
        let result = parse(CompactionHookStage::SessionStartCompact, output);
        assert_eq!(result.outcome, CompactionHookOutcome::Failed, "{output}");
        assert!(result.additional_contexts.is_empty());
    }
}

#[test]
fn errors_and_byte_limits_discard_context_without_truncating() {
    for code in [None, Some(1)] {
        let result = CompactionHookResult::from_process_output(
            CompactionHookStage::SessionStartCompact,
            code,
            "context",
            4096,
        );
        assert_eq!(result.outcome, CompactionHookOutcome::Failed);
        assert!(result.additional_contexts.is_empty());
    }
    let text = "研究";
    let accepted = CompactionHookResult::from_process_output(
        CompactionHookStage::SessionStartCompact,
        Some(0),
        text,
        text.len(),
    );
    assert_eq!(accepted.additional_contexts, [text]);
    let rejected = CompactionHookResult::from_process_output(
        CompactionHookStage::SessionStartCompact,
        Some(0),
        text,
        text.len() - 1,
    );
    assert_eq!(rejected.outcome, CompactionHookOutcome::Failed);
    assert!(rejected.additional_contexts.is_empty());
}

#[test]
fn empty_or_diagnostic_output_does_not_inject_context() {
    for output in [
        "",
        " \n",
        "{}",
        r#"{"systemMessage":"warning","suppressOutput":true}"#,
    ] {
        let result = parse(CompactionHookStage::SessionStartCompact, output);
        assert_eq!(result.outcome, CompactionHookOutcome::Continue);
        assert!(result.additional_contexts.is_empty());
    }
}

struct LegacyHost;
impl CompactionHooks for LegacyHost {
    fn notify(&self, _: &CompactionHookRequest, _: CompactionHookNotification) {}
    fn run(&self, _: CompactionHookRequest) -> CompactionHookFuture<'_> {
        Box::pin(async { CompactionHookOutcome::Stop })
    }
}

#[tokio::test]
async fn default_context_port_preserves_legacy_host_outcome() {
    let result = LegacyHost
        .run_with_context(CompactionHookRequest {
            operation_id: uuid::Uuid::from_u128(1),
            conversation_id: uuid::Uuid::from_u128(2),
            turn_id: uuid::Uuid::from_u128(3),
            phase: crate::context::compaction_strategy::CompactionPhase::Manual,
            model: crate::protocol::ModelIdentity {
                provider_id: "fixture".into(),
                model_id: "model".into(),
                revision: None,
            },
            stage: CompactionHookStage::SessionStartCompact,
        })
        .await;
    assert_eq!(
        result,
        CompactionHookResult::without_context(CompactionHookOutcome::Stop)
    );
}
