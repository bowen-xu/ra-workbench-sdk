//! No-model reset policy adapted at contract level from OpenAI Codex
//! compact_token_budget.rs / session/mod.rs (Apache-2.0), commit
//! e363b08c9175ac1cbe5893615dd2cb9ddf95043b. Copyright 2025 OpenAI.
//! The task owner captures canonical context and commits the checkpoint before
//! advancing the window. This strategy has no provider or tool executor.
use crate::context::compaction_strategy::*;
use crate::{model::ModelUsage, protocol::ModelIdentity};

pub struct TokenBudgetResetStrategy {
    binding: CompactionBinding,
}

impl TokenBudgetResetStrategy {
    pub fn new(model: ModelIdentity) -> Result<Self, CompactionFailure> {
        let binding = CompactionBinding {
            model,
            strategy_id: "token-budget.reset-window".into(),
            state_schema: 1,
            kind: CompactionKind::ResetWindow,
        };
        binding.validate()?;
        Ok(Self { binding })
    }
}

impl CompactionStrategy for TokenBudgetResetStrategy {
    fn binding(&self) -> CompactionBinding {
        self.binding.clone()
    }

    fn retention_policy(&self) -> Option<CompactionRetention> {
        Some(CompactionRetention::ResetWindow)
    }

    fn validate_output(&self, output: &CompactionOutput) -> Result<(), CompactionFailure> {
        if matches!(output, CompactionOutput::ResetWindow) {
            Ok(())
        } else {
            Err(CompactionFailure::InvalidOutput)
        }
    }

    fn compact(&self, request: CompactionRequest) -> CompactionFuture<'_, CompactionCandidate> {
        Box::pin(async move {
            if request.binding != self.binding || request.source.model != self.binding.model {
                return Err(CompactionFailure::Incompatible);
            }
            Ok(CompactionCandidate {
                binding: self.binding.clone(),
                credential_scope_id: None,
                output: CompactionOutput::ResetWindow,
                usage: ModelUsage::default(),
                response_id: None,
            })
        })
    }
}
