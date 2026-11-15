//! Provider-neutral compaction request/candidate boundary, adapted from OpenAI
//! Codex (Apache-2.0), commit e363b08c9175ac1cbe5893615dd2cb9ddf95043b:
//! core/src/tasks/compact.rs, compact_remote_v2.rs and session/turn.rs.
//! Copyright 2025 OpenAI. Application differences are recorded in the migration map.
//!
//! A candidate is not installed history. The task owner must persist its validated
//! replacement against the captured history revision before publishing completion.

use crate::{model::*, protocol::ModelIdentity};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{future::Future, pin::Pin};
use uuid::Uuid;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CompactionKind {
    TextSummary,
    RemoteOpaque,
    RemoteWindow,
    /// Discard active history and rebuild authoritative context without model I/O.
    ResetWindow,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CompactionPhase {
    Manual,
    PreTurn,
    MidTurn,
}

/// Exact provider/model/revision and strategy schema captured at admission.
/// Compatibility is an adapter decision, never inferred from a model name or URL.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CompactionBinding {
    pub model: ModelIdentity,
    pub strategy_id: String,
    pub state_schema: u32,
    pub kind: CompactionKind,
}

impl CompactionBinding {
    pub fn validate(&self) -> Result<(), CompactionFailure> {
        if self.model.provider_id.trim().is_empty()
            || self.model.model_id.trim().is_empty()
            || self.strategy_id.trim().is_empty()
            || self.strategy_id.len() > 256
            || self.strategy_id.chars().any(char::is_control)
            || self.state_schema == 0
        {
            return Err(CompactionFailure::InvalidBinding);
        }
        Ok(())
    }
}

/// Active context usage is distinct from cumulative billed input/output usage.
/// Estimates must include instructions and tool definitions. Unknown limits do
/// not become a guessed model window; manual compaction remains separately usable.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CompactionBudget {
    pub context_window_tokens: u64,
    pub effective_percent: u8,
    pub configured_trigger_tokens: Option<u64>,
    /// Frozen output setting retained for request compatibility; Codex does not
    /// subtract it from the effective context window or compaction threshold.
    pub output_reserve_tokens: u64,
}

impl CompactionBudget {
    pub fn limits(self) -> Result<(u64, u64), CompactionFailure> {
        self.limits_for_scope(super::accounting::AutoCompactionScope::Total)
    }

    pub fn limits_for_scope(
        self,
        scope: super::accounting::AutoCompactionScope,
    ) -> Result<(u64, u64), CompactionFailure> {
        if self.context_window_tokens == 0
            || self.effective_percent == 0
            || self.effective_percent > 100
            || self.configured_trigger_tokens == Some(0)
        {
            return Err(CompactionFailure::InvalidBudget);
        }
        let scale = |percent: u8| {
            let window = u128::from(self.context_window_tokens);
            (window * u128::from(percent) / 100) as u64
        };
        let hard = scale(self.effective_percent);
        if hard == 0 {
            return Err(CompactionFailure::InvalidBudget);
        }
        let trigger = match (scope, self.configured_trigger_tokens) {
            (super::accounting::AutoCompactionScope::BodyAfterPrefix, Some(trigger)) => trigger,
            _ => self
                .configured_trigger_tokens
                .unwrap_or(u64::MAX)
                .min(scale(90)),
        };
        if trigger == 0 {
            return Err(CompactionFailure::InvalidBudget);
        }
        Ok((trigger, hard))
    }

    pub fn should_compact(self, active_tokens: u64) -> Result<bool, CompactionFailure> {
        let (trigger, hard) = self.limits()?;
        Ok(active_tokens >= trigger || active_tokens >= hard)
    }
}

/// A frozen request snapshot. Pending steer stays outside this snapshot and is
/// drained by the regular runner only at the post-compaction sampling boundary.
#[derive(Clone)]
pub struct CompactionRequest {
    pub operation_id: Uuid,
    pub conversation_id: Uuid,
    pub turn_id: Uuid,
    pub history_revision: u64,
    pub phase: CompactionPhase,
    pub binding: CompactionBinding,
    pub source: ModelRequest,
    pub max_result_bytes: usize,
}

/// No plaintext interpretation of opaque state. RemoteWindow is a complete
/// provider-returned window; its owner must not treat it as one opaque item.
/// These values can contain private context and must not enter diagnostic logs.
#[derive(Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
pub enum CompactionOutput {
    TextSummary(String),
    RemoteOpaque(Value),
    RemoteWindow(Vec<Value>),
    ResetWindow,
}

#[derive(Clone)]
pub struct CompactionCandidate {
    pub binding: CompactionBinding,
    /// Opaque/window state belongs to the account scope that produced it. This
    /// is a non-secret identity, never a credential or a guessed provider id.
    pub credential_scope_id: Option<Uuid>,
    pub output: CompactionOutput,
    pub usage: ModelUsage,
    /// Provider response identity for ordinary streamed compaction. Legacy
    /// window endpoints may have no response identity; do not fabricate one.
    pub response_id: Option<String>,
}

#[derive(Debug, PartialEq, Eq, thiserror::Error)]
pub enum CompactionFailure {
    #[error("invalid compaction strategy binding")]
    InvalidBinding,
    #[error("compaction strategy is incompatible with the frozen model")]
    Incompatible,
    #[error("invalid compaction budget")]
    InvalidBudget,
    #[error("invalid compaction output")]
    InvalidOutput,
    #[error("compaction output exceeds its storage budget")]
    OutputBudget,
    #[error(transparent)]
    Model(#[from] ModelError),
}

pub type CompactionFuture<'a, T> =
    Pin<Box<dyn Future<Output = Result<T, CompactionFailure>> + Send + 'a>>;

/// Local retention is supplier policy, not implied by an opaque output shape.
/// The host applies its memory guard independently of provider token limits.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum CompactionRetention {
    RecentUserText,
    RecentUserMessages,
    /// Supplier output owns the complete replacement; do not locally retain history.
    ProviderWindow,
    /// Keep only newly captured canonical context, never old user messages.
    ResetWindow,
}

/// Injected provider/model strategy. The adapter owns response completion,
/// retry/transport capability, authorization and wire decoding. Dropping this
/// future must cancel owned I/O; no detached summarizer or tool execution loop.
pub trait CompactionStrategy: Send + Sync {
    /// Frozen producer policy, including a previous turn of the same model.
    fn tool_output_policy(&self) -> Option<crate::model::tool_output::ToolOutputPolicy> {
        None
    }
    /// Resolved textual prompt for native transport decoration/recomposition.
    /// Remote opaque/window suppliers do not reinterpret it as their instructions.
    fn text_compaction_prompt(&self) -> Option<&str> {
        None
    }
    /// Producer-bound accounting for handoffs. Missing limits stay unknown;
    /// never borrow the consuming model's capacity for a different producer.
    fn input_accounting(&self) -> Option<std::sync::Arc<super::accounting::ContextAccounting>> {
        None
    }
    fn binding(&self) -> CompactionBinding;
    /// Producer identity for lifecycle evidence. An explicitly compatible
    /// handoff may bind new state to the consuming model while using an old one.
    fn execution_model(&self) -> ModelIdentity {
        self.binding().model
    }
    /// Explicit supplier authorization for one current-model attempt after a
    /// failed previous-model operation. The task owner records both attempts;
    /// this does not authorize transport retries or checkpoint-install retries.
    fn allows_current_model_fallback(&self, _error: &ModelError) -> bool {
        false
    }
    /// Read compatibility is distinct from the binding of newly produced state.
    /// Suppliers must explicitly opt in to another model's stored state; the
    /// default preserves exact provider/model/revision and codec identity.
    fn accepts_binding(&self, stored: &CompactionBinding) -> bool {
        stored == &self.binding()
    }
    fn retention_policy(&self) -> Option<CompactionRetention> {
        (self.binding().kind == CompactionKind::TextSummary)
            .then_some(CompactionRetention::RecentUserText)
    }
    fn retained_text_policy(
        &self,
    ) -> Option<std::sync::Arc<dyn super::retained_text::RetainedTextPolicy>> {
        None
    }
    /// Validate the supplier's protocol without imposing another supplier's schema.
    fn validate_output(&self, output: &CompactionOutput) -> Result<(), CompactionFailure>;
    /// Validate a previously installed window. Adapters may support reading
    /// another codec without accepting it as a newly produced candidate.
    fn validate_stored_output(
        &self,
        _binding: &CompactionBinding,
        output: &CompactionOutput,
    ) -> Result<(), CompactionFailure> {
        self.validate_output(output)
    }
    fn compact(&self, request: CompactionRequest) -> CompactionFuture<'_, CompactionCandidate>;
}

/// Validate before transport and again before returning a candidate. Failures
/// never become a deterministic truncation fallback or a success checkpoint.
pub async fn prepare_compaction(
    strategy: &dyn CompactionStrategy,
    request: CompactionRequest,
) -> Result<CompactionCandidate, CompactionFailure> {
    request.binding.validate()?;
    if request.operation_id.is_nil()
        || request.conversation_id.is_nil()
        || request.turn_id.is_nil()
        || request.max_result_bytes == 0
    {
        return Err(CompactionFailure::InvalidBudget);
    }
    if request.binding != strategy.binding() || request.source.model != request.binding.model {
        return Err(CompactionFailure::Incompatible);
    }
    let binding = request.binding.clone();
    let max_bytes = request.max_result_bytes;
    let candidate = strategy.compact(request).await?;
    if candidate.binding != binding {
        return Err(CompactionFailure::Incompatible);
    }
    let valid_scope = match (binding.kind, candidate.credential_scope_id) {
        (CompactionKind::TextSummary | CompactionKind::ResetWindow, None) => true,
        (CompactionKind::RemoteOpaque | CompactionKind::RemoteWindow, Some(id)) => !id.is_nil(),
        _ => false,
    };
    if !valid_scope {
        return Err(CompactionFailure::Incompatible);
    }
    validate_output(&candidate.output, binding.kind, max_bytes)?;
    strategy.validate_output(&candidate.output)?;
    Ok(candidate)
}

fn validate_output(
    output: &CompactionOutput,
    kind: CompactionKind,
    max_bytes: usize,
) -> Result<(), CompactionFailure> {
    let valid = match (kind, output) {
        (CompactionKind::ResetWindow, CompactionOutput::ResetWindow) => true,
        // Empty suffix semantics belong to the injected supplier. The native
        // text installer adds its historical handoff prefix before persistence.
        (CompactionKind::TextSummary, CompactionOutput::TextSummary(_)) => true,
        (CompactionKind::RemoteOpaque, CompactionOutput::RemoteOpaque(item)) => {
            item.as_object().is_some_and(|object| !object.is_empty())
        }
        (CompactionKind::RemoteWindow, CompactionOutput::RemoteWindow(items)) => {
            // A provider may replace the entire history with an empty window.
            // Supplier-specific validation still runs independently.
            items.iter().all(Value::is_object)
        }
        _ => false,
    };
    if !valid {
        return Err(CompactionFailure::InvalidOutput);
    }
    // Measure the actual persisted representation, not an opaque token estimate.
    let bytes = serde_json::to_vec(output).map_err(|_| CompactionFailure::InvalidOutput)?;
    if bytes.len() > max_bytes {
        return Err(CompactionFailure::OutputBudget);
    }
    Ok(())
}

/// Mirrors run_turn's can_drain_pending_input boundary. Manual tasks are never
/// steerable; automatic compaction inside a regular turn retains its queued input.
pub fn drain_steer_after_compaction(phase: CompactionPhase, model_needs_follow_up: bool) -> bool {
    phase == CompactionPhase::MidTurn && !model_needs_follow_up
}

#[cfg(test)]
#[path = "compaction_strategy_tests.rs"]
mod tests;
