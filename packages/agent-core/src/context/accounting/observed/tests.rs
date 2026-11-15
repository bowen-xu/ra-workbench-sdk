use super::*;
use crate::context::{checkpoint::ContextCheckpoint, compaction_strategy::*};
use crate::protocol::ModelIdentity;

fn text(value: &str) -> ModelMessage {
    ModelMessage::User {
        content: vec![ContentPart::Text(value.into())],
        source_item_id: None,
    }
}
fn estimator() -> ServerObservedEstimator {
    ServerObservedEstimator::new(Arc::new(Utf8JsonTokenEstimator))
}
fn usage(input: u64, output: u64) -> ModelUsage {
    ModelUsage {
        input_tokens: Some(input),
        output_tokens: Some(output),
    }
}
fn window() -> ContextCheckpoint {
    ContextCheckpoint {
        schema_version: 1,
        window_id: Uuid::from_u128(1),
        conversation_id: Uuid::from_u128(2),
        turn_id: Uuid::from_u128(3),
        source_watermark: 0,
        previous_window_id: None,
        binding: CompactionBinding {
            model: ModelIdentity {
                provider_id: "fixture".into(),
                model_id: "fixture".into(),
                revision: None,
            },
            strategy_id: "fixture".into(),
            state_schema: 1,
            kind: CompactionKind::TextSummary,
        },
        credential_scope_id: None,
        phase: CompactionPhase::Manual,
        output: CompactionOutput::TextSummary("summary".into()),
        retained: vec![],
        canonical_context: None,
    }
}

#[test]
fn latest_response_usage_plus_local_tail_replaces_instead_of_accumulating() {
    let estimator = estimator();
    let mut messages = vec![text("already observed")];
    estimator
        .observe(&messages, &[], usage(900, 100), None)
        .unwrap();
    assert_eq!(
        estimator.estimate_window(&messages, &[], None).unwrap(),
        Some(1000)
    );
    let tail = ModelMessage::ToolResult {
        call_id: "tool1".into(),
        content: "evidence".into(),
        is_error: false,
    };
    let delta = Utf8JsonTokenEstimator
        .estimate(std::slice::from_ref(&tail), &[])
        .unwrap();
    messages.push(tail);
    assert_eq!(
        estimator.estimate_window(&messages, &[], None).unwrap(),
        Some(1000 + delta)
    );
    estimator
        .observe(&messages, &[], usage(1300, 50), None)
        .unwrap();
    assert_eq!(
        estimator.estimate_window(&messages, &[], None).unwrap(),
        Some(1350)
    );
}

#[test]
fn window_prefix_and_tool_changes_invalidate_the_observation() {
    let estimator = estimator();
    let messages = vec![text("same prefix")];
    let mut checkpoint = window();
    estimator
        .observe(&messages, &[], usage(900, 100), Some(&checkpoint))
        .unwrap();
    assert_eq!(
        estimator
            .estimate_window(&messages, &[], Some(&checkpoint))
            .unwrap(),
        Some(1000)
    );
    checkpoint.window_id = Uuid::from_u128(4);
    assert_eq!(
        estimator
            .estimate_window(&messages, &[], Some(&checkpoint))
            .unwrap(),
        Utf8JsonTokenEstimator.estimate(&messages, &[])
    );
    checkpoint.window_id = Uuid::from_u128(1);
    assert_eq!(
        estimator
            .estimate_window(&[text("changed authority")], &[], Some(&checkpoint))
            .unwrap(),
        Utf8JsonTokenEstimator.estimate(&[text("changed authority")], &[])
    );
    let tools = vec![ToolDefinition {
        namespace: None,
        name: "read".into(),
        description: "changed schema".into(),
        parameters: json!({}),
    }];
    assert_eq!(
        estimator
            .estimate_window(&messages, &tools, Some(&checkpoint))
            .unwrap(),
        Utf8JsonTokenEstimator.estimate(&messages, &tools)
    );
}

#[test]
fn missing_complete_usage_clears_baseline_and_unknown_tail_is_not_zero() {
    let estimator = estimator();
    let mut messages = vec![text("observed")];
    estimator
        .observe(&messages, &[], usage(900, 100), None)
        .unwrap();
    messages.push(ModelMessage::User {
        content: vec![ContentPart::Image {
            media_type: "image/png".into(),
            bytes: Arc::from([1u8]),
        }],
        source_item_id: None,
    });
    assert_eq!(
        estimator.estimate_window(&messages, &[], None).unwrap(),
        None
    );
    messages.pop();
    estimator
        .observe(
            &messages,
            &[],
            ModelUsage {
                input_tokens: Some(500),
                output_tokens: None,
            },
            None,
        )
        .unwrap();
    assert_eq!(
        estimator.estimate_window(&messages, &[], None).unwrap(),
        Utf8JsonTokenEstimator.estimate(&messages, &[])
    );
}

#[test]
fn observed_and_tail_overflow_are_explicit_errors() {
    let estimator = estimator();
    assert_eq!(
        estimator.observe(&[], &[], usage(u64::MAX, 1), None),
        Err(ModelError::BudgetExceeded)
    );
    estimator
        .observe(&[], &[], usage(u64::MAX, 0), None)
        .unwrap();
    assert_eq!(
        estimator.estimate_window(&[text("tail")], &[], None),
        Err(ModelError::BudgetExceeded)
    );
}

#[test]
fn different_actual_model_cannot_establish_or_reuse_the_exact_model_baseline() {
    let model = window().binding.model;
    let accounting = ContextAccounting {
        unknown_window_trigger_tokens: None,
        model: model.clone(),
        budget: None,
        estimator: Arc::new(estimator()),
    };
    let request = ModelRequest {
        captured_history: None,
        request_id: Uuid::from_u128(5),
        model: model.clone(),
        messages: vec![text("completed prefix")],
        tools: vec![],
        max_output_tokens: 128,
        parallel_tool_calls: false,
        reasoning_effort: None,
    };
    let mut response = ModelResponse {
        response_id: "response1".into(),
        actual_model: model.clone(),
        actual_model_observed: true,
        text: "done".into(),
        output: vec![],
        end_turn: None,
        tool_calls: vec![],
        usage: usage(900, 100),
    };
    accounting
        .observe_response(&request, &response, None)
        .unwrap();
    assert_eq!(
        accounting.estimate(&model, &request.messages, &[]).unwrap(),
        Some(1000)
    );
    response.actual_model.revision = Some("other revision".into());
    accounting
        .observe_response(&request, &response, None)
        .unwrap();
    assert_eq!(
        accounting.estimate(&model, &request.messages, &[]).unwrap(),
        Utf8JsonTokenEstimator.estimate(&request.messages, &[])
    );
}
