use super::*;

#[test]
fn text_handoff_is_counted_by_the_new_model_without_rebinding_provenance() {
    let accounting = policy(Some(budget()));
    let mut checkpoint = window(CompactionOutput::TextSummary("portable evidence".into()));
    checkpoint.binding.model.provider_id = "previous-provider".into();
    let messages = vec![ModelMessage::User {
        content: vec![ContentPart::Text("portable evidence".into())],
        source_item_id: None,
    }];
    assert!(
        accounting
            .check_window(&model(), &messages, &[], Some(&checkpoint))
            .is_ok()
    );
    assert_eq!(checkpoint.binding.model.provider_id, "previous-provider");
    checkpoint.output =
        CompactionOutput::RemoteOpaque(serde_json::json!({"encrypted_content":"opaque"}));
    checkpoint.binding.kind = CompactionKind::RemoteOpaque;
    assert_eq!(
        accounting.estimate_window(&model(), &messages, &[], Some(&checkpoint)),
        Err(ModelError::InvalidRequest)
    );
}

#[test]
fn explicit_unknown_window_threshold_is_not_a_guessed_hard_capacity() {
    let mut accounting = policy(None);
    accounting.unknown_window_trigger_tokens = Some(100);
    let small = vec![ModelMessage::User {
        content: vec![ContentPart::Text("short".into())],
        source_item_id: None,
    }];
    let large = vec![ModelMessage::User {
        content: vec![ContentPart::Text("a".repeat(1000))],
        source_item_id: None,
    }];
    assert!(!accounting.should_compact(&model(), &small, &[]).unwrap());
    assert!(accounting.should_compact(&model(), &large, &[]).unwrap());
    assert!(accounting.check(&model(), &large, &[]).is_ok());
    assert!(accounting.budget.is_none());
    let mut known = policy(Some(budget()));
    known.unknown_window_trigger_tokens = Some(1);
    assert!(!known.should_compact(&model(), &small, &[]).unwrap());
    accounting.unknown_window_trigger_tokens = Some(0);
    assert_eq!(
        accounting.should_compact(&model(), &large, &[]),
        Err(ModelError::InvalidRequest)
    );
    assert_eq!(
        accounting.check(&model(), &large, &[]),
        Err(ModelError::InvalidRequest)
    );
}

#[test]
fn unknown_window_trigger_does_not_make_unknown_image_usage_zero() {
    let mut accounting = policy(None);
    accounting.unknown_window_trigger_tokens = Some(1);
    let messages = vec![ModelMessage::User {
        content: vec![ContentPart::Image {
            media_type: "image/png".into(),
            bytes: Arc::from([1u8, 2u8]),
        }],
        source_item_id: None,
    }];
    assert_eq!(accounting.estimate(&model(), &messages, &[]).unwrap(), None);
    assert!(!accounting.should_compact(&model(), &messages, &[]).unwrap());
}
use crate::context::compaction_strategy::{CompactionBinding, CompactionKind, CompactionPhase};

fn model() -> ModelIdentity {
    ModelIdentity {
        provider_id: "fixture".into(),
        model_id: "text".into(),
        revision: None,
    }
}
fn policy(budget: Option<CompactionBudget>) -> ContextAccounting {
    ContextAccounting {
        unknown_window_trigger_tokens: None,
        model: model(),
        budget,
        estimator: Arc::new(Utf8JsonTokenEstimator),
    }
}
fn budget() -> CompactionBudget {
    CompactionBudget {
        context_window_tokens: 1000,
        effective_percent: 95,
        configured_trigger_tokens: None,
        output_reserve_tokens: 100,
    }
}

fn window(output: CompactionOutput) -> ContextCheckpoint {
    ContextCheckpoint {
        schema_version: 1,
        window_id: uuid::Uuid::from_u128(1),
        conversation_id: uuid::Uuid::from_u128(2),
        turn_id: uuid::Uuid::from_u128(3),
        source_watermark: 0,
        previous_window_id: None,
        binding: CompactionBinding {
            model: model(),
            strategy_id: "fixture".into(),
            state_schema: 1,
            kind: if matches!(&output, CompactionOutput::TextSummary(_)) {
                CompactionKind::TextSummary
            } else {
                CompactionKind::RemoteOpaque
            },
        },
        credential_scope_id: None,
        phase: CompactionPhase::Manual,
        output,
        retained: vec![],
        canonical_context: None,
    }
}

#[test]
fn unknown_opaque_state_is_not_zero_and_text_summary_is_not_double_counted() {
    let accounting = policy(Some(budget()));
    let messages = vec![ModelMessage::User {
        content: vec![ContentPart::Text("summary".into())],
        source_item_id: None,
    }];
    let text = window(CompactionOutput::TextSummary("summary".into()));
    assert_eq!(
        accounting.estimate_window(&model(), &messages, &[], Some(&text)),
        accounting.estimate(&model(), &messages, &[])
    );
    let mut opaque = window(CompactionOutput::RemoteOpaque(json!({"state":"opaque"})));
    assert_eq!(
        accounting
            .estimate_window(&model(), &messages, &[], Some(&opaque))
            .unwrap(),
        None
    );
    opaque.binding.model.revision = Some("incompatible".into());
    assert_eq!(
        accounting.estimate_window(&model(), &messages, &[], Some(&opaque)),
        Err(ModelError::InvalidRequest)
    );
}

struct StateCost(u64);
impl ContextTokenEstimator for StateCost {
    fn estimate(&self, messages: &[ModelMessage], tools: &[ToolDefinition]) -> Option<u64> {
        Utf8JsonTokenEstimator.estimate(messages, tools)
    }
    fn estimate_compaction(&self, _: &CompactionOutput) -> Option<u64> {
        Some(self.0)
    }
}

#[test]
fn injected_state_cost_triggers_compaction_and_checks_replacement_without_accumulation() {
    let mut accounting = policy(Some(budget()));
    accounting.estimator = Arc::new(StateCost(900));
    let opaque = window(CompactionOutput::RemoteOpaque(json!({"state":"opaque"})));
    assert!(!accounting.should_compact(&model(), &[], &[]).unwrap());
    assert!(
        accounting
            .should_compact_window(&model(), &[], &[], Some(&opaque))
            .unwrap()
    );
    accounting
        .check_window(&model(), &[], &[], Some(&opaque))
        .unwrap();
    accounting.estimator = Arc::new(StateCost(951));
    assert_eq!(
        accounting.check_window(&model(), &[], &[], Some(&opaque)),
        Err(ModelError::BudgetExceeded)
    );
    accounting.estimator = Arc::new(StateCost(10));
    assert_eq!(
        accounting
            .estimate_window(&model(), &[], &[], Some(&opaque))
            .unwrap(),
        Some(10)
    );
    accounting
        .check_window(&model(), &[], &[], Some(&opaque))
        .unwrap();
    accounting.estimator = Arc::new(StateCost(u64::MAX));
    assert_eq!(
        accounting.estimate_window(
            &model(),
            &[ModelMessage::System("rules".into())],
            &[],
            Some(&opaque)
        ),
        Err(ModelError::BudgetExceeded)
    );
}

#[test]
fn counts_utf8_json_escaping_rules_calls_and_tool_schemas() {
    let messages = vec![ModelMessage::System("中文\n\"rules\"".into())];
    let expected = serde_json::to_vec(&json!({"role":"system", "content":"中文\n\"rules\""}))
        .unwrap()
        .len()
        .div_ceil(4) as u64;
    assert_eq!(
        Utf8JsonTokenEstimator.estimate(&messages, &[]),
        Some(expected)
    );
    let tool = ToolDefinition {
        namespace: None,
        name: "read".into(),
        description: "evidence".into(),
        parameters: json!({"type":"object"}),
    };
    let with_tools = Utf8JsonTokenEstimator.estimate(&messages, &[tool]).unwrap();
    assert!(with_tools > expected);
    let mut extended = messages;
    extended.push(ModelMessage::Assistant {
        phase: None,
        content: vec![],
        tool_calls: vec![ToolCall {
            namespace: None,
            raw_arguments_json: None,
            call_id: "call".into(),
            name: "read".into(),
            arguments: json!({"path":"paper"}),
        }],
    });
    extended.push(ModelMessage::ToolResult {
        call_id: "call".into(),
        content: "verified source".into(),
        is_error: false,
    });
    assert!(Utf8JsonTokenEstimator.estimate(&extended, &[]).unwrap() > expected);
}

#[test]
fn unknown_images_or_windows_do_not_become_zero_or_guessed_capacity() {
    let image = ModelMessage::User {
        content: vec![ContentPart::Image {
            media_type: "image/png".into(),
            bytes: vec![1; 1024].into(),
        }],
        source_item_id: None,
    };
    let accounting = policy(Some(budget()));
    assert_eq!(
        accounting
            .estimate(&model(), std::slice::from_ref(&image), &[])
            .unwrap(),
        None
    );
    assert!(!accounting.should_compact(&model(), &[image], &[]).unwrap());
    let messages = vec![ModelMessage::System("x".repeat(8000))];
    assert!(
        policy(None)
            .estimate(&model(), &messages, &[])
            .unwrap()
            .unwrap()
            > 1000
    );
    assert!(
        !policy(None)
            .should_compact(&model(), &messages, &[])
            .unwrap()
    );
    assert!(policy(None).check(&model(), &messages, &[]).is_ok());
}

#[test]
fn trigger_and_request_capacity_follow_the_effective_window() {
    let accounting = policy(Some(budget())); // trigger=900, effective window=950
    let messages = vec![ModelMessage::System("x".repeat(3400))];
    assert!(!accounting.should_compact(&model(), &messages, &[]).unwrap());
    assert!(accounting.check(&model(), &messages, &[]).is_ok());
    let mut wrong = model();
    wrong.revision = Some("other".into());
    assert_eq!(
        accounting.estimate(&wrong, &messages, &[]),
        Err(ModelError::InvalidRequest)
    );
    let mut invalid = budget();
    invalid.effective_percent = 0;
    assert_eq!(
        policy(Some(invalid)).check(&model(), &[], &[]),
        Err(ModelError::InvalidRequest)
    );
}

#[test]
fn successive_requests_are_estimated_without_accumulating_billed_usage() {
    let accounting = policy(Some(budget()));
    let old = vec![ModelMessage::System("x".repeat(3600))];
    let compact = vec![
        ModelMessage::System("rules".into()),
        ModelMessage::User {
            content: vec![ContentPart::Text("summary".into())],
            source_item_id: None,
        },
    ];
    assert!(accounting.should_compact(&model(), &old, &[]).unwrap());
    assert!(!accounting.should_compact(&model(), &compact, &[]).unwrap());
}
