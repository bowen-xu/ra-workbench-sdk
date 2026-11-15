use super::*;
use crate::context::{
    accounting::{AutoCompactionScope, ContextTokenEstimator, PrefillScopedEstimator},
    compaction_strategy::CompactionBudget,
};
use std::sync::Arc;
use uuid::Uuid;

#[test]
fn abandoned_proposal_preserves_once_claims_and_new_window_request() {
    let mut window = TokenBudgetWindow::initial(id(1)).unwrap();
    let abandoned = window.prepare_post_sampling(&policy(), status(100), false);
    assert!(abandoned.decision().reminder.is_some());
    assert!(abandoned.decision().fallback.is_some());
    drop(abandoned); // host persistence failed
    let retry = window.prepare_post_sampling(&policy(), status(100), false);
    let committed = window.commit_post_sampling(retry).unwrap();
    assert!(committed.reminder.is_some() && committed.fallback.is_some());
    let once = window.prepare_post_sampling(&policy(), status(100), false);
    assert!(once.decision().reminder.is_none() && once.decision().fallback.is_none());
    window.request_new_context_window();
    let abandoned = window.prepare_post_sampling(&policy(), status(10), true);
    assert!(abandoned.decision().rollover);
    drop(abandoned);
    assert!(window.take_new_context_window_request());
}

#[test]
fn stale_proposal_cannot_overwrite_new_request_or_window_identity() {
    let mut window = TokenBudgetWindow::initial(id(1)).unwrap();
    let old = window.prepare_post_sampling(&policy(), status(100), false);
    window.request_new_context_window();
    assert!(window.commit_post_sampling(old).is_err());
    assert!(window.take_new_context_window_request());
    let old = window.prepare_post_sampling(&policy(), status(100), false);
    window.advance(id(2)).unwrap();
    assert!(window.commit_post_sampling(old).is_err());
    assert_eq!(window.id(), id(2));
    let fresh = window.prepare_post_sampling(&policy(), status(100), false);
    assert!(fresh.decision().reminder.is_some() && fresh.decision().fallback.is_some());
}

#[test]
fn only_one_of_two_prepared_claims_can_commit() {
    let mut window = TokenBudgetWindow::initial(id(1)).unwrap();
    let first = window.prepare_post_sampling(&policy(), status(100), false);
    let second = window.prepare_post_sampling(&policy(), status(100), false);
    assert!(
        window
            .commit_post_sampling(first)
            .unwrap()
            .fallback
            .is_some()
    );
    assert!(window.commit_post_sampling(second).is_err());
    assert!(
        window
            .post_sampling(&policy(), status(100), false)
            .fallback
            .is_none()
    );
}
fn id(n: u128) -> Uuid {
    Uuid::from_u128(n)
}
fn policy() -> TokenBudgetPolicy {
    TokenBudgetPolicy::resolve(TokenBudgetSettings {
        reminder_threshold_tokens: Some(20),
        reminder_message_template: "Remain {n_remaining}; save {n_remaining}".into(),
        auto_compact_fallback_prompt: Some("save notes before reset".into()),
        auto_compact_fallback_buffer_tokens: Some(50),
        ..Default::default()
    })
    .unwrap()
}
fn status(active: u64) -> TokenBudgetStatus {
    TokenBudgetStatus::from_usage(Some(active), Some(active), Some(100), Some(200), 50)
}
#[test]
fn buffered_budget_preserves_unbuffered_remaining_and_forces_at_either_limit() {
    assert_eq!(status(99).base_window_tokens_remaining, Some(1));
    assert_eq!(status(100).base_window_tokens_remaining, Some(0));
    assert!(!status(149).token_limit_reached);
    assert!(status(150).token_limit_reached);
    let hard = TokenBudgetStatus::from_usage(Some(200), Some(3), Some(100), Some(200), 50);
    assert_eq!(hard.base_window_tokens_remaining, Some(0));
    assert!(hard.full_context_window_limit_reached && hard.token_limit_reached);
    let no_limit = TokenBudgetStatus::from_usage(Some(u64::MAX), Some(u64::MAX), None, None, 50);
    assert_eq!(no_limit.base_window_tokens_remaining, None);
    assert!(!no_limit.token_limit_reached);
    assert!(no_limit.remaining_message().contains("unknown"));
    let no_usage = TokenBudgetStatus::from_usage(None, None, Some(100), Some(200), 0);
    assert_eq!(no_usage.base_window_tokens_remaining, None);
    assert!(!no_usage.token_limit_reached);
}
#[test]
fn reminder_and_fallback_are_independent_once_claims_reset_after_installation() {
    let mut window = TokenBudgetWindow::initial(id(1)).unwrap();
    let policy = policy();
    let first = window.post_sampling(&policy, status(80), true);
    assert_eq!(first.reminder.as_deref(), Some("Remain 20; save 20"));
    assert!(first.fallback.is_none() && !first.rollover);
    let second = window.post_sampling(&policy, status(100), true);
    assert!(second.reminder.is_none());
    assert_eq!(second.fallback.as_deref(), Some("save notes before reset"));
    let repeat = window.post_sampling(&policy, status(140), true);
    assert!(repeat.reminder.is_none() && repeat.fallback.is_none());
    assert!(!repeat.rollover);
    assert!(window.post_sampling(&policy, status(150), true).rollover);
    window.advance(id(2)).unwrap();
    assert_eq!(
        (
            window.number(),
            window.first_id(),
            window.previous_id(),
            window.id()
        ),
        (1, id(1), Some(id(1)), id(2))
    );
    let fresh = window.post_sampling(&policy, status(100), true);
    assert!(fresh.reminder.is_some() && fresh.fallback.is_some());
}
#[test]
fn new_context_only_requests_and_natural_end_does_not_consume_it() {
    let mut window = TokenBudgetWindow::initial(id(1)).unwrap();
    window.request_new_context_window();
    assert_eq!(window.id(), id(1));
    assert!(!window.post_sampling(&policy(), status(10), false).rollover);
    assert_eq!(window.number(), 0);
    assert!(window.post_sampling(&policy(), status(10), true).rollover);
    assert!(!window.post_sampling(&policy(), status(10), true).rollover);
    window.advance(id(2)).unwrap();
    assert!(!window.post_sampling(&policy(), status(10), true).rollover);
}
#[test]
fn fallback_is_suppressed_by_pending_reset_and_hard_or_buffer_exhaustion() {
    for mode in 0..3 {
        let mut window = TokenBudgetWindow::initial(id(1)).unwrap();
        if mode == 0 {
            window.request_new_context_window();
        }
        let usage = match mode {
            0 => status(100),
            1 => status(150),
            _ => TokenBudgetStatus::from_usage(Some(200), Some(10), Some(100), Some(200), 50),
        };
        let decision = window.post_sampling(&policy(), usage, true);
        assert!(decision.rollover && decision.fallback.is_none());
    }
    let mut window = TokenBudgetWindow::initial(id(1)).unwrap();
    let ended = window.post_sampling(&policy(), status(150), false);
    assert!(!ended.rollover && ended.fallback.is_none());
    // Like upstream, a reminder may be recorded even when this turn has ended.
    assert!(ended.reminder.is_some());
}
#[test]
fn restored_window_has_fresh_runtime_claims_and_rejects_invalid_identity_changes() {
    let mut window = TokenBudgetWindow::restore(3, id(1), Some(id(2)), id(3)).unwrap();
    assert!(
        window
            .post_sampling(&policy(), status(100), true)
            .fallback
            .is_some()
    );
    for invalid in [Uuid::nil(), id(1), id(2), id(3)] {
        assert!(window.advance(invalid).is_err());
        assert_eq!(window.id(), id(3));
        assert!(
            window
                .post_sampling(&policy(), status(100), true)
                .fallback
                .is_none()
        );
    }
    assert!(TokenBudgetWindow::restore(0, id(1), Some(id(2)), id(1)).is_err());
    assert!(TokenBudgetWindow::restore(1, id(1), None, id(2)).is_err());
    assert!(TokenBudgetWindow::initial(Uuid::nil()).is_err());
}
#[test]
fn configured_buffer_without_prompt_is_inactive_and_prompt_requires_positive_buffer() {
    let settings = TokenBudgetSettings {
        auto_compact_fallback_buffer_tokens: Some(50),
        ..Default::default()
    };
    assert!(
        TokenBudgetPolicy::resolve(settings.clone())
            .unwrap()
            .settings()
            == &settings
    );
    assert_eq!(
        TokenBudgetPolicy::resolve(TokenBudgetSettings {
            auto_compact_fallback_prompt: Some("  \n ".into()),
            ..settings
        })
        .unwrap()
        .fallback_buffer_tokens(),
        0
    );
    assert!(
        TokenBudgetPolicy::resolve(TokenBudgetSettings {
            auto_compact_fallback_prompt: Some("save".into()),
            ..Default::default()
        })
        .is_err()
    );
    for field in 0..3 {
        let mut settings = TokenBudgetSettings::default();
        match field {
            0 => settings.reminder_threshold_tokens = Some(0),
            1 => settings.auto_compact_fallback_buffer_tokens = Some(0),
            _ => settings.reminder_message_template = " ".into(),
        }
        assert!(TokenBudgetPolicy::resolve(settings).is_err());
    }
}
#[test]
fn message_limits_are_utf8_bytes_and_never_silently_truncated() {
    for field in 0..3 {
        let mut settings = TokenBudgetSettings::default();
        let text = "界".repeat(667);
        match field {
            0 => settings.reminder_message_template = text,
            1 => settings.guidance_message = Some(text),
            _ => {
                settings.auto_compact_fallback_prompt = Some(text);
                settings.auto_compact_fallback_buffer_tokens = Some(1);
            }
        }
        assert!(TokenBudgetPolicy::resolve(settings).is_err());
    }
    let settings = TokenBudgetSettings {
        guidance_message: Some("x".repeat(2000)),
        ..Default::default()
    };
    let resolved = TokenBudgetPolicy::resolve(settings.clone()).unwrap();
    assert!(resolved.settings().eq(&settings));
}
struct Bytes;
impl ContextTokenEstimator for Bytes {
    fn estimate(&self, messages: &[ModelMessage], _: &[ToolDefinition]) -> Option<u64> {
        Some(
            messages
                .iter()
                .map(|message| {
                    if let ModelMessage::System(text) = message {
                        text.len() as u64
                    } else {
                        0
                    }
                })
                .sum(),
        )
    }
}
#[test]
fn exact_model_accounting_and_existing_prefill_port_determine_scoped_remaining() {
    let model = ModelIdentity {
        provider_id: "fixture".into(),
        model_id: "model".into(),
        revision: Some("v1".into()),
    };
    let estimator = Arc::new(PrefillScopedEstimator::new(Arc::new(Bytes)));
    let accounting = ContextAccounting {
        model: model.clone(),
        budget: Some(CompactionBudget {
            context_window_tokens: 2000,
            effective_percent: 100,
            configured_trigger_tokens: Some(500),
            output_reserve_tokens: 100,
        }),
        unknown_window_trigger_tokens: None,
        estimator: estimator.clone(),
    };
    assert_eq!(
        estimator.auto_compaction_scope(),
        AutoCompactionScope::BodyAfterPrefix
    );
    let policy = policy();
    let initial = policy
        .status(
            &accounting,
            &model,
            &[ModelMessage::System("x".repeat(200))],
            &[],
            None,
        )
        .unwrap();
    assert_eq!(initial.base_window_tokens_remaining, Some(500));
    estimator
        .observe(
            &[],
            &[],
            crate::model::ModelUsage {
                input_tokens: Some(100),
                output_tokens: Some(25),
            },
            None,
        )
        .unwrap();
    let next = policy
        .status(
            &accounting,
            &model,
            &[ModelMessage::System("x".repeat(200))],
            &[],
            None,
        )
        .unwrap();
    assert_eq!(next.auto_compact_scope_tokens, Some(100));
    assert_eq!(next.base_window_tokens_remaining, Some(400));
    assert_eq!(next.full_context_window_limit, Some(2000));
    let changed = ModelIdentity {
        revision: None,
        ..model
    };
    assert!(matches!(
        policy.status(&accounting, &changed, &[], &[], None),
        Err(ModelError::InvalidRequest)
    ));
}

#[test]
fn injected_unknown_capacity_and_usage_remain_distinct_from_zero_remaining() {
    struct Unknown;
    impl ContextTokenEstimator for Unknown {
        fn estimate(&self, _: &[ModelMessage], _: &[ToolDefinition]) -> Option<u64> {
            None
        }
    }
    let model = ModelIdentity {
        provider_id: "fixture".into(),
        model_id: "model".into(),
        revision: None,
    };
    let mut accounting = ContextAccounting {
        model: model.clone(),
        budget: None,
        unknown_window_trigger_tokens: Some(100),
        estimator: Arc::new(Unknown),
    };
    let policy = policy();
    let unknown = policy.status(&accounting, &model, &[], &[], None).unwrap();
    assert_eq!(unknown.base_window_tokens_remaining, None);
    let mut window = TokenBudgetWindow::initial(id(1)).unwrap();
    let decision = window.post_sampling(&policy, unknown, true);
    assert!(!decision.rollover && decision.reminder.is_none() && decision.fallback.is_none());
    accounting.estimator = Arc::new(Bytes);
    let known = policy
        .status(
            &accounting,
            &model,
            &[ModelMessage::System("x".repeat(100))],
            &[],
            None,
        )
        .unwrap();
    assert_eq!(known.full_context_window_limit, None);
    assert_eq!(known.base_window_tokens_remaining, Some(0));
    assert!(
        window
            .post_sampling(&policy, known, true)
            .fallback
            .is_some()
    );
    accounting.unknown_window_trigger_tokens = Some(0);
    assert!(policy.status(&accounting, &model, &[], &[], None).is_err());
}
#[test]
fn buffer_arithmetic_saturates_without_turning_hard_capacity_into_spare_space() {
    let status = TokenBudgetStatus::from_usage(Some(100), Some(99), Some(100), Some(100), u64::MAX);
    assert!(status.token_limit_reached && status.full_context_window_limit_reached);
    assert_eq!(status.base_window_tokens_remaining, Some(0));
    let status = TokenBudgetStatus::from_usage(Some(99), Some(99), Some(100), None, u64::MAX);
    assert!(!status.token_limit_reached);
}

#[test]
fn guidance_renders_as_an_independent_fragment_without_rewriting_host_text() {
    let text = "  Keep durable notes.\nUse source anchors.  ";
    let policy = TokenBudgetPolicy::resolve(TokenBudgetSettings {
        guidance_message: Some(text.into()),
        ..Default::default()
    })
    .unwrap();
    assert_eq!(
        policy.guidance_fragment().unwrap(),
        format!("<context_window_guidance>\n{text}\n</context_window_guidance>")
    );
    for guidance_message in [None, Some(" \n\t".into())] {
        let policy = TokenBudgetPolicy::resolve(TokenBudgetSettings {
            guidance_message,
            ..Default::default()
        })
        .unwrap();
        assert!(policy.guidance_fragment().is_none());
    }
}
