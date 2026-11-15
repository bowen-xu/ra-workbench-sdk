//! Textual checkpoint request adapted from Apache-2.0 OpenAI Codex,
//! e363b08c9175ac1cbe5893615dd2cb9ddf95043b core/src/compact.rs and
//! prompts/templates/compact/prompt.md. Copyright 2025 OpenAI.
//! The injected regular transport owns I/O. This strategy never executes tools,
//! installs history or replaces a failed summary with sliced transcript text.

use super::compaction_strategy::*;
use crate::model::*;
use crate::{
    resilience::{RetryDecision, RetryPolicy},
    runner::{RetryWait, RunError},
};
use std::sync::Arc;
#[path = "text_compaction_retry.rs"]
mod retry;

// Adapted handoff requirements; research-specific evidence anchors are added.
const HANDOFF_PROMPT: &str = "You are performing a CONTEXT CHECKPOINT COMPACTION. Create a handoff summary for another model that will resume the task. Include current progress and key decisions; important constraints and user preferences; remaining tasks and clear next steps; critical data, examples and references. Preserve research evidence identities, original-source anchors, versions, experiment parameters and caveats. Be concise and structured. Do not execute tools or perform the unfinished task.";

pub struct TextCompactionStrategy {
    prompt: String,
    transport: Arc<dyn ModelTransport>,
    binding: CompactionBinding,
    retry: RetryPolicy,
    retry_wait: Option<Arc<dyn RetryWait>>,
}

impl TextCompactionStrategy {
    pub fn new(
        transport: Arc<dyn ModelTransport>,
        binding: CompactionBinding,
    ) -> Result<Self, CompactionFailure> {
        binding.validate()?;
        if binding.kind != CompactionKind::TextSummary {
            return Err(CompactionFailure::Incompatible);
        }
        Ok(Self {
            prompt: HANDOFF_PROMPT.into(),
            transport,
            binding,
            retry: RetryPolicy {
                max_attempts: 1,
                base_delay_ms: 0,
                max_delay_ms: 0,
            },
            retry_wait: None,
        })
    }
    pub fn with_compact_prompt(mut self, prompt: String) -> Result<Self, CompactionFailure> {
        validate_compact_prompt(&prompt)?;
        self.prompt = prompt;
        Ok(self)
    }
    pub fn with_retry_policy(
        mut self,
        policy: RetryPolicy,
        wait: Arc<dyn RetryWait>,
    ) -> Result<Self, CompactionFailure> {
        if policy.max_attempts == 0
            || policy.base_delay_ms > policy.max_delay_ms
            || policy.max_delay_ms > 30_000
        {
            return Err(CompactionFailure::InvalidBudget);
        }
        self.retry = policy;
        self.retry_wait = Some(wait);
        Ok(self)
    }

    async fn attempt(
        &self,
        request: ModelRequest,
        max_bytes: usize,
    ) -> Result<CompactionCandidate, CompactionFailure> {
        request.validate(self.transport.capabilities())?;
        if let Some(accounting) = self.transport.context_accounting() {
            match accounting.check(&self.binding.model, &request.messages, &request.tools) {
                Err(ModelError::BudgetExceeded) => {
                    return Err(ModelError::ContextWindowExceeded.into());
                }
                result => result?,
            }
        }
        let requested_model = request.model.clone();
        let mut stream = self.transport.start_text_compaction(request).await?;
        let mut assembler = ResponseAssembler::new(StreamLimits {
            text_bytes: max_bytes,
            argument_bytes: 1,
            tool_calls: 1,
        })?
        .with_requested_model(requested_model);
        while let Some(event) = stream.next().await? {
            if matches!(event, ModelStreamEvent::ToolCallStarted { .. })
                || matches!(&event,ModelStreamEvent::OutputItemDone(item)
                    if matches!(item.normalized,Some(ModelOutputItem::ToolCall(_))))
            {
                return Err(CompactionFailure::InvalidOutput);
            }
            let completed = matches!(event, ModelStreamEvent::Completed { .. });
            assembler.push(event)?;
            if completed {
                break;
            }
        }
        let response = assembler.finish()?;
        if response.actual_model != self.binding.model {
            return Err(CompactionFailure::InvalidOutput);
        }
        Ok(CompactionCandidate {
            binding: self.binding.clone(),
            credential_scope_id: None,
            output: CompactionOutput::TextSummary(response.text),
            usage: response.usage,
            response_id: Some(response.response_id),
        })
    }
}

impl CompactionStrategy for TextCompactionStrategy {
    fn text_compaction_prompt(&self) -> Option<&str> {
        Some(&self.prompt)
    }
    fn binding(&self) -> CompactionBinding {
        self.binding.clone()
    }

    fn accepts_binding(&self, stored: &CompactionBinding) -> bool {
        stored.validate().is_ok()
            && stored.kind == CompactionKind::TextSummary
            && stored.strategy_id == self.binding.strategy_id
            && stored.state_schema == self.binding.state_schema
    }

    fn validate_output(&self, output: &CompactionOutput) -> Result<(), CompactionFailure> {
        match output {
            // Codex compact.rs accepts a completed response with an empty suffix.
            // The installer owns the prefix; incomplete streams remain errors.
            CompactionOutput::TextSummary(_) => Ok(()),
            _ => Err(CompactionFailure::InvalidOutput),
        }
    }

    fn compact(&self, input: CompactionRequest) -> CompactionFuture<'_, CompactionCandidate> {
        Box::pin(async move {
            if input.binding != self.binding || input.source.model != self.binding.model {
                return Err(CompactionFailure::Incompatible);
            }
            // Start with full captured history, including call/result pairs and
            // images. Only explicit capacity failures authorize oldest-item removal.
            let mut request = input.source;
            request.request_id = input.operation_id;
            request.messages.push(ModelMessage::User {
                content: vec![ContentPart::Text(self.prompt.clone())],
                source_item_id: None,
            });
            request.tools.clear();
            request.parallel_tool_calls = false;
            let mut attempts = 0u8;
            loop {
                attempts = attempts.saturating_add(1);
                match self.attempt(request.clone(), input.max_result_bytes).await {
                    Ok(candidate) => return Ok(candidate),
                    Err(CompactionFailure::Model(ModelError::ContextWindowExceeded))
                        if retry::remove_oldest(&mut request) =>
                    {
                        attempts = 0;
                    }
                    Err(CompactionFailure::Model(error)) => {
                        match self.retry.decide(error, attempts) {
                            RetryDecision::Retry { delay_ms } => {
                                let wait = self
                                    .retry_wait
                                    .as_ref()
                                    .ok_or(CompactionFailure::InvalidBudget)?;
                                wait.wait(delay_ms).await.map_err(|error| match error {
                                    RunError::Model(error) => CompactionFailure::Model(error),
                                    _ => CompactionFailure::InvalidBudget,
                                })?;
                            }
                            RetryDecision::Stop => return Err(error.into()),
                        }
                    }
                    Err(error) => return Err(error),
                }
            }
        })
    }
}

/// Host-owned configuration, frozen before sampling. Do not silently truncate
/// a custom prompt or read mutable files during compaction/retry.
pub fn validate_compact_prompt(prompt: &str) -> Result<(), CompactionFailure> {
    if prompt.trim().is_empty()
        || prompt.len() > 32 * 1024
        || prompt
            .chars()
            .any(|ch| ch.is_control() && !matches!(ch, '\n' | '\r' | '\t'))
    {
        return Err(CompactionFailure::InvalidOutput);
    }
    Ok(())
}

#[cfg(test)]
#[path = "text_compaction_tests.rs"]
mod tests;
