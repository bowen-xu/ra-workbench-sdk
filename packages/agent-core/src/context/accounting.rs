//! Model-bound active-window accounting. Text byte estimation is adapted from
//! OpenAI Codex context_manager/history.rs (Apache-2.0), commit
//! e363b08c9175ac1cbe5893615dd2cb9ddf95043b. This is not billed usage or a tokenizer.
use super::compaction_strategy::CompactionBudget;
use super::{checkpoint::ContextCheckpoint, compaction_strategy::CompactionOutput};
use crate::{model::*, protocol::ModelIdentity};
use serde_json::{Value, json};
use std::sync::Arc;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AutoCompactionScope {
    #[default]
    Total,
    BodyAfterPrefix,
}

/// Provider-specific tokenizers and modality policies can replace this port.
/// None means unknown, never zero; no binary payload may be counted as text.
pub trait ContextTokenEstimator: Send + Sync {
    fn prepare_auto_compaction<'a>(
        &'a self,
        _active: Option<u64>,
        _checkpoint: Option<&'a ContextCheckpoint>,
    ) -> ModelFuture<'a, ()> {
        Box::pin(async { Ok(()) })
    }
    fn persist_auto_compaction<'a>(
        &'a self,
        _checkpoint: Option<&'a ContextCheckpoint>,
    ) -> ModelFuture<'a, ()> {
        Box::pin(async { Ok(()) })
    }
    fn auto_compaction_scope(&self) -> AutoCompactionScope {
        AutoCompactionScope::Total
    }
    fn auto_compaction_tokens(
        &self,
        active_tokens: Option<u64>,
        _checkpoint: Option<&ContextCheckpoint>,
    ) -> Result<Option<u64>, ModelError> {
        Ok(active_tokens)
    }
    fn estimate(&self, messages: &[ModelMessage], tools: &[ToolDefinition]) -> Option<u64>;
    fn estimate_window(
        &self,
        messages: &[ModelMessage],
        tools: &[ToolDefinition],
        checkpoint: Option<&ContextCheckpoint>,
    ) -> Result<Option<u64>, ModelError> {
        let extra = checkpoint.map_or(Some(0), |window| self.estimate_compaction(&window.output));
        match self.estimate(messages, tools).zip(extra) {
            Some((base, extra)) => base
                .checked_add(extra)
                .map(Some)
                .ok_or(ModelError::BudgetExceeded),
            None => Ok(None),
        }
    }
    /// Only complete, validated sampling responses may establish a baseline.
    /// Compaction candidate usage is not usage of the installed replacement.
    fn observe(
        &self,
        _messages: &[ModelMessage],
        _tools: &[ToolDefinition],
        _usage: ModelUsage,
        _checkpoint: Option<&ContextCheckpoint>,
    ) -> Result<(), ModelError> {
        Ok(())
    }
    /// Extra protocol state absent from normalized messages. Text summaries are
    /// already in messages. Opaque state is unknown unless the supplier opts in.
    fn estimate_compaction(&self, output: &CompactionOutput) -> Option<u64> {
        match output {
            CompactionOutput::TextSummary(_) | CompactionOutput::ResetWindow => Some(0),
            _ => None,
        }
    }
    /// Optional text allocation heuristic owned by this estimator, not the host.
    /// Actual serialized replacement must still be checked before installation.
    fn text_byte_budget(&self, _tokens: u64) -> Option<usize> {
        None
    }
}

pub struct ContextAccounting {
    pub model: ModelIdentity,
    pub budget: Option<CompactionBudget>,
    /// A frozen explicit threshold remains usable when model capacity is unknown.
    /// Known windows use their scoped CompactionBudget and hard capacity instead.
    pub unknown_window_trigger_tokens: Option<u64>,
    pub estimator: Arc<dyn ContextTokenEstimator>,
}

impl ContextAccounting {
    pub async fn prepare_auto_compaction(
        &self,
        model: &ModelIdentity,
        messages: &[ModelMessage],
        tools: &[ToolDefinition],
        checkpoint: Option<&ContextCheckpoint>,
    ) -> Result<(), ModelError> {
        let active = self.estimate_window(model, messages, tools, checkpoint)?;
        self.estimator
            .prepare_auto_compaction(active, checkpoint)
            .await
    }
    pub fn estimate(
        &self,
        model: &ModelIdentity,
        messages: &[ModelMessage],
        tools: &[ToolDefinition],
    ) -> Result<Option<u64>, ModelError> {
        self.estimate_window(model, messages, tools, None)
    }

    pub fn estimate_window(
        &self,
        model: &ModelIdentity,
        messages: &[ModelMessage],
        tools: &[ToolDefinition],
        checkpoint: Option<&ContextCheckpoint>,
    ) -> Result<Option<u64>, ModelError> {
        if model != &self.model {
            return Err(ModelError::InvalidRequest);
        }
        if let Some(checkpoint) = checkpoint
            && &checkpoint.binding.model != model
            && !matches!(checkpoint.output, CompactionOutput::TextSummary(_))
        {
            return Err(ModelError::InvalidRequest);
        }
        // Plaintext is estimated using this model's estimator, without changing
        // its producer provenance. Runtime strategy/codec authorization precedes
        // accounting; opaque state remains tied to its exact model here.
        self.estimator.estimate_window(messages, tools, checkpoint)
    }

    pub fn observe_response(
        &self,
        request: &ModelRequest,
        response: &ModelResponse,
        checkpoint: Option<&ContextCheckpoint>,
    ) -> Result<(), ModelError> {
        if request.model != self.model
            || checkpoint.is_some_and(|window| {
                window.binding.model != self.model
                    && !matches!(window.output, CompactionOutput::TextSummary(_))
            })
        {
            return Err(ModelError::InvalidRequest);
        }
        // Model aliases/revisions cannot establish an exact-model baseline.
        let usage = if response.actual_model_observed && response.actual_model == self.model {
            response.usage
        } else {
            ModelUsage::default()
        };
        self.estimator
            .observe(&request.messages, &request.tools, usage, checkpoint)
    }

    pub fn should_compact(
        &self,
        model: &ModelIdentity,
        messages: &[ModelMessage],
        tools: &[ToolDefinition],
    ) -> Result<bool, ModelError> {
        self.should_compact_window(model, messages, tools, None)
    }

    pub fn should_compact_window(
        &self,
        model: &ModelIdentity,
        messages: &[ModelMessage],
        tools: &[ToolDefinition],
        checkpoint: Option<&ContextCheckpoint>,
    ) -> Result<bool, ModelError> {
        let estimate = self.estimate_window(model, messages, tools, checkpoint)?;
        let body = self
            .estimator
            .auto_compaction_tokens(estimate, checkpoint)?;
        let limits = self
            .budget
            .map(|budget| budget.limits_for_scope(self.estimator.auto_compaction_scope()))
            .transpose()
            .map_err(|_| ModelError::InvalidRequest)?;
        match limits {
            Some((trigger, usable)) => Ok(body.is_some_and(|tokens| tokens >= trigger)
                || estimate.is_some_and(|tokens| tokens >= usable)),
            None => match self.unknown_window_trigger_tokens {
                Some(0) => Err(ModelError::InvalidRequest),
                Some(trigger) => Ok(body.is_some_and(|tokens| tokens >= trigger)),
                None => Ok(false),
            },
        }
    }

    pub fn check(
        &self,
        model: &ModelIdentity,
        messages: &[ModelMessage],
        tools: &[ToolDefinition],
    ) -> Result<(), ModelError> {
        self.check_window(model, messages, tools, None)
    }

    pub fn check_window(
        &self,
        model: &ModelIdentity,
        messages: &[ModelMessage],
        tools: &[ToolDefinition],
        checkpoint: Option<&ContextCheckpoint>,
    ) -> Result<(), ModelError> {
        let estimate = self.estimate_window(model, messages, tools, checkpoint)?;
        let limits = self.limits()?;
        if estimate
            .zip(limits)
            .is_some_and(|(tokens, (_, usable))| tokens > usable)
        {
            return Err(ModelError::BudgetExceeded);
        }
        Ok(())
    }

    fn limits(&self) -> Result<Option<(u64, u64)>, ModelError> {
        if self.budget.is_none() && self.unknown_window_trigger_tokens == Some(0) {
            return Err(ModelError::InvalidRequest);
        }
        self.budget
            .map(CompactionBudget::limits)
            .transpose()
            .map_err(|_| ModelError::InvalidRequest)
    }
}

/// Generic text-only heuristic: UTF-8 JSON bytes / 4, rounded up per item.
/// Includes roles, tool calls, escaped strings, instructions and tool schemas.
/// Provider wire formats differ; images return unknown until a modality-aware
/// estimator is injected. The whole current request is estimated independently.
pub struct Utf8JsonTokenEstimator;
impl ContextTokenEstimator for Utf8JsonTokenEstimator {
    fn text_byte_budget(&self, tokens: u64) -> Option<usize> {
        usize::try_from(tokens.checked_mul(4)?).ok()
    }
    fn estimate(&self, messages: &[ModelMessage], tools: &[ToolDefinition]) -> Option<u64> {
        let mut total = 0u64;
        for message in messages {
            let value = match message {
                ModelMessage::System(text) => json!({"role":"system", "content":text}),
                ModelMessage::Developer(text) => json!({"role":"developer", "content":text}),
                ModelMessage::CanonicalOutput(item) => {
                    item.validate().ok()?;
                    // A provider-specific estimator must opt in to opaque
                    // material; its token cost is not the JSON byte length.
                    if item.native.is_some() {
                        return None;
                    }
                    match &item.normalized {
                        Some(ModelOutputItem::Message(message)) => {
                            json!({"role":"assistant","content":[{"type":"text","text":message.text}],"tool_calls":[],"phase":message.phase})
                        }
                        Some(ModelOutputItem::ReasoningSummary(summary)) => {
                            json!({"role":"reasoning-summary","text":summary.text,"parts":summary.parts})
                        }
                        Some(ModelOutputItem::ToolCall(call)) => {
                            let mut value = json!({"role":"assistant","content":[],"tool_calls":[{"id":call.call_id,"type":"function","function":{"name":call.name,"arguments":call.raw_arguments_json}}]});
                            if let Some(namespace) = &call.namespace {
                                value["tool_calls"][0]["function"]["namespace"] = json!(namespace);
                            }
                            value
                        }
                        None => return None,
                    }
                }
                ModelMessage::User { content, .. } => {
                    json!({"role":"user", "content":parts(content)?})
                }
                ModelMessage::Assistant {
                    content,
                    tool_calls,
                    phase,
                } => {
                    let calls: Vec<_> = tool_calls
                        .iter()
                        .map(|call| {
                            let mut value = json!({
                                "id":call.call_id, "type":"function", "function":{
                                    "name":call.name, "arguments":call.arguments_json().ok()?
                                }
                            });
                            if let Some(namespace) = &call.namespace {
                                value["function"]["namespace"] = json!(namespace);
                            }
                            Some(value)
                        })
                        .collect::<Option<_>>()?;
                    let mut value =
                        json!({"role":"assistant", "content":parts(content)?, "tool_calls":calls});
                    if let Some(phase) = phase {
                        value["phase"] = json!(phase);
                    }
                    value
                }
                ModelMessage::ToolResult {
                    call_id,
                    content,
                    is_error,
                } => {
                    json!({"role":"tool", "tool_call_id":call_id, "content":content, "is_error":is_error})
                }
            };
            total = total.checked_add(tokens(&value)?)?;
        }
        for tool in tools {
            let mut value = json!({"type":"function", "function":{
                "name":tool.name, "description":tool.description, "parameters":tool.parameters
            }});
            if let Some(namespace) = &tool.namespace {
                value["function"]["namespace"] = json!(namespace);
            }
            total = total.checked_add(tokens(&value)?)?;
        }
        Some(total)
    }
}
fn parts(content: &[ContentPart]) -> Option<Vec<Value>> {
    content
        .iter()
        .map(|part| match part {
            ContentPart::Text(text) => Some(json!({"type":"text", "text":text})),
            ContentPart::Image { .. } => None,
        })
        .collect()
}
fn tokens(value: &Value) -> Option<u64> {
    let bytes = serde_json::to_vec(value).ok()?;
    Some(u64::try_from(bytes.len()).ok()?.div_ceil(4))
}

#[cfg(test)]
mod tests;

mod observed;
pub use observed::ServerObservedEstimator;
mod prefill;
pub use prefill::{PrefillBaseline, PrefillScopedEstimator};
