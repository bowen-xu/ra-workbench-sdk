use super::*;

#[test]
fn body_growth_triggers_before_full_window_is_exhausted() {
    body_growth_triggers(false);
}
#[test]
fn unknown_window_body_threshold_counts_growth_without_hard_capacity() {
    body_growth_triggers(true);
}
fn body_growth_triggers(unknown_window: bool) {
    let model = ModelIdentity {
        provider_id: "test".into(),
        model_id: "test".into(),
        revision: None,
    };
    let estimator = Arc::new(PrefillScopedEstimator::new(Arc::new(
        ServerObservedEstimator::new(Arc::new(Utf8JsonTokenEstimator)),
    )));
    let accounting = ContextAccounting {
        unknown_window_trigger_tokens: unknown_window.then_some(60),
        model: model.clone(),
        budget: (!unknown_window).then_some(CompactionBudget {
            context_window_tokens: 1000,
            effective_percent: 95,
            configured_trigger_tokens: Some(60),
            output_reserve_tokens: 50,
        }),
        estimator: estimator.clone(),
    };
    let messages = vec![ModelMessage::User {
        content: vec![ContentPart::Text("prefix".into())],
        source_item_id: None,
    }];
    assert!(!accounting.should_compact(&model, &messages, &[]).unwrap());
    estimator
        .observe(
            &messages,
            &[],
            ModelUsage {
                input_tokens: Some(100),
                output_tokens: Some(59),
            },
            None,
        )
        .unwrap();
    assert!(!accounting.should_compact(&model, &messages, &[]).unwrap());
    estimator
        .observe(
            &messages,
            &[],
            ModelUsage {
                input_tokens: Some(159),
                output_tokens: Some(1),
            },
            None,
        )
        .unwrap();
    assert!(accounting.should_compact(&model, &messages, &[]).unwrap());
    assert!(accounting.check(&model, &messages, &[]).is_ok());
}

#[test]
fn composed_active_usage_counts_first_output_as_body_growth() {
    let estimator = PrefillScopedEstimator::new(Arc::new(ServerObservedEstimator::new(Arc::new(
        Utf8JsonTokenEstimator,
    ))));
    let messages = vec![ModelMessage::User {
        content: vec![ContentPart::Text("prefill".into())],
        source_item_id: None,
    }];
    let initial = estimator.estimate_window(&messages, &[], None).unwrap();
    assert_eq!(
        estimator.auto_compaction_tokens(initial, None).unwrap(),
        Some(0)
    );
    estimator
        .observe(
            &messages,
            &[],
            ModelUsage {
                input_tokens: Some(100),
                output_tokens: Some(40),
            },
            None,
        )
        .unwrap();
    let active = estimator.estimate_window(&messages, &[], None).unwrap();
    assert_eq!(active, Some(140));
    assert_eq!(
        estimator.auto_compaction_tokens(active, None).unwrap(),
        Some(40)
    );
}

#[test]
fn installing_a_new_window_resets_estimated_and_observed_prefill() {
    use crate::context::compaction_strategy::{CompactionBinding, CompactionKind, CompactionPhase};
    let mut checkpoint = ContextCheckpoint {
        schema_version: 1,
        window_id: Uuid::from_u128(1),
        conversation_id: Uuid::from_u128(2),
        turn_id: Uuid::from_u128(3),
        source_watermark: 0,
        previous_window_id: None,
        binding: CompactionBinding {
            model: ModelIdentity {
                provider_id: "test".into(),
                model_id: "test".into(),
                revision: None,
            },
            strategy_id: "text".into(),
            state_schema: 1,
            kind: CompactionKind::TextSummary,
        },
        credential_scope_id: None,
        phase: CompactionPhase::Manual,
        output: CompactionOutput::TextSummary("summary".into()),
        retained: vec![],
        canonical_context: None,
    };
    let estimator = PrefillScopedEstimator::new(Arc::new(Utf8JsonTokenEstimator));
    estimator
        .observe(
            &[],
            &[],
            ModelUsage {
                input_tokens: Some(100),
                output_tokens: Some(20),
            },
            Some(&checkpoint),
        )
        .unwrap();
    assert_eq!(
        estimator
            .auto_compaction_tokens(Some(150), Some(&checkpoint))
            .unwrap(),
        Some(50)
    );
    checkpoint.window_id = Uuid::from_u128(4);
    assert_eq!(
        estimator
            .auto_compaction_tokens(Some(40), Some(&checkpoint))
            .unwrap(),
        Some(0)
    );
    estimator
        .observe(
            &[],
            &[],
            ModelUsage {
                input_tokens: Some(30),
                output_tokens: Some(10),
            },
            Some(&checkpoint),
        )
        .unwrap();
    assert_eq!(
        estimator
            .auto_compaction_tokens(Some(40), Some(&checkpoint))
            .unwrap(),
        Some(10)
    );
    assert_eq!(
        estimator.auto_compaction_tokens(Some(200), None).unwrap(),
        Some(0)
    );
}

#[test]
fn first_input_observation_replaces_estimate_but_not_with_output() {
    let estimator = PrefillScopedEstimator::new(Arc::new(Utf8JsonTokenEstimator));
    assert_eq!(
        estimator.auto_compaction_tokens(Some(100), None).unwrap(),
        Some(0)
    );
    assert_eq!(
        estimator.auto_compaction_tokens(Some(140), None).unwrap(),
        Some(40)
    );
    estimator
        .observe(
            &[],
            &[],
            ModelUsage {
                input_tokens: Some(120),
                output_tokens: Some(40),
            },
            None,
        )
        .unwrap();
    assert_eq!(
        estimator.auto_compaction_tokens(Some(160), None).unwrap(),
        Some(40)
    );
    estimator
        .observe(
            &[],
            &[],
            ModelUsage {
                input_tokens: Some(200),
                output_tokens: Some(10),
            },
            None,
        )
        .unwrap();
    assert_eq!(
        estimator.auto_compaction_tokens(Some(210), None).unwrap(),
        Some(90)
    );
    assert_eq!(
        estimator.auto_compaction_tokens(Some(50), None).unwrap(),
        Some(0)
    );
    assert_eq!(estimator.auto_compaction_tokens(None, None).unwrap(), None);
}

#[test]
fn unknown_input_does_not_freeze_prefill_and_observation_can_come_first() {
    let estimator = PrefillScopedEstimator::new(Arc::new(Utf8JsonTokenEstimator));
    estimator
        .observe(
            &[],
            &[],
            ModelUsage {
                output_tokens: Some(40),
                ..Default::default()
            },
            None,
        )
        .unwrap();
    assert_eq!(
        estimator.auto_compaction_tokens(Some(100), None).unwrap(),
        Some(0)
    );
    estimator
        .observe(
            &[],
            &[],
            ModelUsage {
                input_tokens: Some(90),
                ..Default::default()
            },
            None,
        )
        .unwrap();
    assert_eq!(
        estimator.auto_compaction_tokens(Some(110), None).unwrap(),
        Some(20)
    );
    let fresh = PrefillScopedEstimator::new(Arc::new(Utf8JsonTokenEstimator));
    fresh
        .observe(
            &[],
            &[],
            ModelUsage {
                input_tokens: Some(90),
                ..Default::default()
            },
            None,
        )
        .unwrap();
    assert_eq!(
        fresh.auto_compaction_tokens(Some(110), None).unwrap(),
        Some(20)
    );
}

#[test]
fn explicit_body_threshold_is_not_clamped_and_full_window_still_triggers() {
    let budget = CompactionBudget {
        context_window_tokens: 1000,
        effective_percent: 95,
        configured_trigger_tokens: Some(980),
        output_reserve_tokens: 50,
    };
    assert_eq!(budget.limits().unwrap(), (900, 950));
    assert_eq!(
        budget
            .limits_for_scope(AutoCompactionScope::BodyAfterPrefix)
            .unwrap(),
        (980, 950)
    );
    let model = ModelIdentity {
        provider_id: "test".into(),
        model_id: "test".into(),
        revision: None,
    };
    let accounting = ContextAccounting {
        unknown_window_trigger_tokens: None,
        model: model.clone(),
        budget: Some(budget),
        estimator: Arc::new(PrefillScopedEstimator::new(Arc::new(
            Utf8JsonTokenEstimator,
        ))),
    };
    let small = vec![ModelMessage::User {
        content: vec![ContentPart::Text("short".into())],
        source_item_id: None,
    }];
    assert!(!accounting.should_compact(&model, &small, &[]).unwrap());
    let oversized = vec![ModelMessage::User {
        content: vec![ContentPart::Text("a".repeat(4000))],
        source_item_id: None,
    }];
    assert!(accounting.should_compact(&model, &oversized, &[]).unwrap());
    assert_eq!(
        accounting.check(&model, &oversized, &[]),
        Err(ModelError::BudgetExceeded)
    );
}
