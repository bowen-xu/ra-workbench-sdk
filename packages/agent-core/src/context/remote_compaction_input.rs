//! Tail rewriting adapted from OpenAI Codex compact_remote.rs, Apache-2.0,
//! e363b08c9175ac1cbe5893615dd2cb9ddf95043b. Copyright 2025 OpenAI.
//! The provider injects its estimator and effective input window. Never mutate
//! the journal, search earlier outputs, or claim that rewriting guarantees fit.
use super::{accounting::ContextTokenEstimator, checkpoint::ContextCheckpoint};
use crate::model::{ModelError, ModelMessage, ToolDefinition};

const TRUNCATED_OUTPUT: &str = "Output exceeded the available model context and was truncated";

/// Prepare each producer attempt from the unmodified source. A fallback can
/// use a different window/estimator and must not inherit the failed clone.
pub fn prepare_model_input(
    producer: &crate::protocol::ModelIdentity,
    accounting: &super::accounting::ContextAccounting,
    messages: &[ModelMessage],
    tools: &[ToolDefinition],
    checkpoint: Option<&ContextCheckpoint>,
) -> Result<Vec<ModelMessage>, ModelError> {
    if producer != &accounting.model {
        return Err(ModelError::InvalidRequest);
    }
    let Some(budget) = accounting.budget else {
        return Ok(messages.to_vec());
    };
    budget.limits().map_err(|_| ModelError::InvalidRequest)?;
    let effective = (u128::from(budget.context_window_tokens)
        * u128::from(budget.effective_percent)
        / 100) as u64;
    prepare_remote_input(
        messages,
        tools,
        checkpoint,
        accounting.estimator.as_ref(),
        effective,
    )
}

pub fn prepare_remote_input(
    messages: &[ModelMessage],
    tools: &[ToolDefinition],
    checkpoint: Option<&ContextCheckpoint>,
    estimator: &dyn ContextTokenEstimator,
    effective_window: u64,
) -> Result<Vec<ModelMessage>, ModelError> {
    if effective_window == 0 {
        return Err(ModelError::InvalidRequest);
    }
    let mut prepared = messages.to_vec();
    for index in (0..prepared.len()).rev() {
        let Some(tokens) = estimator.estimate_window(&prepared, tools, checkpoint)? else {
            // Unknown image/opaque costs cannot be guessed into a known window.
            break;
        };
        if tokens <= effective_window {
            break;
        }
        let ModelMessage::ToolResult { content, .. } = &mut prepared[index] else {
            break;
        };
        *content = TRUNCATED_OUTPUT.into();
    }
    Ok(prepared)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn accounting(model: &str, window: Option<u64>) -> super::super::accounting::ContextAccounting {
        super::super::accounting::ContextAccounting {
            model: crate::protocol::ModelIdentity {
                provider_id: "fixture".into(),
                model_id: model.into(),
                revision: None,
            },
            budget: window.map(|context_window_tokens| {
                super::super::compaction_strategy::CompactionBudget {
                    context_window_tokens,
                    effective_percent: 50,
                    configured_trigger_tokens: None,
                    output_reserve_tokens: 1,
                }
            }),
            unknown_window_trigger_tokens: None,
            estimator: std::sync::Arc::new(Bytes),
        }
    }
    #[test]
    fn each_producer_prepares_a_fresh_clone_with_its_own_effective_window() {
        let source = vec![
            ModelMessage::System("rules".into()),
            output("one"),
            output("two"),
        ];
        let old = accounting("old", Some(400));
        let current = accounting("current", Some(2400));
        let old_input = prepare_model_input(&old.model, &old, &source, &[], None).unwrap();
        assert!(Bytes.estimate(&old_input, &[]).unwrap() <= 200);
        let fallback = prepare_model_input(&current.model, &current, &source, &[], None).unwrap();
        assert!(fallback == source);
        assert!(old_input != fallback);
        assert!(source[2] == output("two"));
    }
    #[test]
    fn unknown_producer_capacity_does_not_borrow_a_consumer_window() {
        let source = vec![output("one")];
        let old = accounting("old", None);
        let consumer = accounting("current", Some(200));
        assert!(prepare_model_input(&old.model, &old, &source, &[], None).unwrap() == source);
        assert!(matches!(
            prepare_model_input(&old.model, &consumer, &source, &[], None),
            Err(ModelError::InvalidRequest)
        ));
        let invalid = accounting("old", Some(0));
        assert!(matches!(
            prepare_model_input(&old.model, &invalid, &source, &[], None),
            Err(ModelError::InvalidRequest)
        ));
    }
    struct Bytes;
    impl ContextTokenEstimator for Bytes {
        fn estimate(&self, messages: &[ModelMessage], _: &[ToolDefinition]) -> Option<u64> {
            Some(
                messages
                    .iter()
                    .map(|message| match message {
                        ModelMessage::ToolResult { content, .. }
                        | ModelMessage::System(content) => content.len() as u64,
                        _ => 1,
                    })
                    .sum(),
            )
        }
    }
    fn output(id: &str) -> ModelMessage {
        ModelMessage::ToolResult {
            call_id: id.into(),
            content: "large".repeat(100),
            is_error: true,
        }
    }
    #[test]
    fn trims_only_until_fit_preserving_status_identity_and_original_input() {
        let input = vec![
            ModelMessage::System("rules".into()),
            output("first"),
            output("last"),
        ];
        let result = prepare_remote_input(&input, &[], None, &Bytes, 600).unwrap();
        assert!(result[1] == input[1]);
        assert!(
            result[2]
                == ModelMessage::ToolResult {
                    call_id: "last".into(),
                    content: TRUNCATED_OUTPUT.into(),
                    is_error: true
                }
        );
        assert!(input[2] == output("last"));
    }
    #[test]
    fn does_not_search_past_a_non_output_even_when_history_still_exceeds_window() {
        let input = vec![
            output("earlier"),
            ModelMessage::System("boundary".into()),
            output("tail"),
        ];
        let result = prepare_remote_input(&input, &[], None, &Bytes, 100).unwrap();
        assert!(result[0] == input[0]);
        assert!(result[1] == input[1]);
        assert!(Bytes.estimate(&result, &[]).unwrap() > 100);
    }
    #[test]
    fn rewrites_multiple_contiguous_results_without_removing_calls_or_rules() {
        let input = vec![
            ModelMessage::System("rules".into()),
            output("one"),
            output("two"),
        ];
        let result = prepare_remote_input(&input, &[], None, &Bytes, 200).unwrap();
        assert!(result[0] == input[0]);
        assert_eq!(result.len(), input.len());
        assert!(Bytes.estimate(&result, &[]).unwrap() <= 200);
    }
    #[test]
    fn unknown_modality_costs_do_not_trigger_destructive_rewriting() {
        struct Unknown;
        impl ContextTokenEstimator for Unknown {
            fn estimate(&self, _: &[ModelMessage], _: &[ToolDefinition]) -> Option<u64> {
                None
            }
        }
        let input = vec![output("one")];
        assert!(prepare_remote_input(&input, &[], None, &Unknown, 1).unwrap() == input);
        assert!(prepare_remote_input(&input, &[], None, &Bytes, 1000).unwrap() == input);
    }
}
