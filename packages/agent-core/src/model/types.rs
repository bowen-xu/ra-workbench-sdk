use crate::protocol::{AssistantMessagePhase, ModelIdentity, NativeItemData};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{future::Future, pin::Pin, sync::Arc};
use uuid::Uuid;

#[derive(Clone, PartialEq)]
pub enum ContentPart {
    Text(String),
    Image {
        media_type: String,
        bytes: Arc<[u8]>,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
/// Parsed arguments handed to a registered executor or supplied by a trusted
/// host. Provider history uses `ToolCallIntent` until durable admission.
pub struct ToolCall {
    pub call_id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub namespace: Option<String>,
    pub arguments: Value,
    /// Original provider JSON, validated against `arguments`; never regenerated
    /// when round-tripping canonical history.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub raw_arguments_json: Option<String>,
}

/// A completed provider intent is historical evidence before it is executable.
/// Keep the original string even when JSON or the target schema is invalid.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(
    rename_all = "camelCase",
    try_from = "super::tool_intent::StoredIntent"
)]
pub struct ToolCallIntent {
    pub call_id: String,
    pub name: String,
    pub raw_arguments_json: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub namespace: Option<String>,
}

#[derive(Clone, PartialEq)]
pub enum ModelMessage {
    System(String),
    /// Host-owned developer context, distinct from real user input.
    Developer(String),
    CanonicalOutput(Box<CompletedModelItem>),
    User {
        content: Vec<ContentPart>,
        source_item_id: Option<Uuid>,
    },
    Assistant {
        content: Vec<ContentPart>,
        tool_calls: Vec<ToolCall>,
        phase: Option<AssistantMessagePhase>,
    },
    ToolResult {
        call_id: String,
        content: String,
        is_error: bool,
    },
}

#[derive(Clone, PartialEq)]
pub struct ToolDefinition {
    pub name: String,
    pub namespace: Option<String>,
    pub description: String,
    pub parameters: Value,
}

#[derive(Clone)]
pub struct ModelRequest {
    pub request_id: Uuid,
    pub model: ModelIdentity,
    pub messages: Vec<ModelMessage>,
    pub tools: Vec<ToolDefinition>,
    pub max_output_tokens: u32,
    pub parallel_tool_calls: bool,
    pub reasoning_effort: Option<String>,
    /// Frozen host provenance only. Adapters must not transmit this reference
    /// or replace it by reading a live conversation during encoding.
    pub captured_history: Option<CapturedHistoryRef>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CapturedHistoryRef {
    pub conversation_id: Uuid,
    pub through_seq: u64,
    pub after_seq: u64,
    pub turns: Vec<CapturedTurnRef>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CapturedTurnRef {
    pub turn_id: Uuid,
    pub user_item_ids: Vec<Uuid>,
}

#[derive(Clone, Debug)]
pub struct ModelCapabilities {
    pub vision: bool,
    pub tools: bool,
    pub parallel_tools: bool,
    /// Exact supported values for this model/transport. Empty disables explicit effort.
    pub reasoning_efforts: Vec<String>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ModelUsage {
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FinishReason {
    Stop,
    ToolCalls,
    Length,
    Filtered,
}

/// Provider adapters normalize wire-specific IDs and fragments into these events.
/// A completed item is independently admissible; response completion controls
/// sampling and usage, and cannot retract earlier accepted tool effects.
#[derive(Clone, Debug)]
pub enum ModelStreamEvent {
    /// The provider supplied a response ID, but has not identified its model.
    StartedWithoutModel {
        response_id: String,
    },
    Started {
        response_id: String,
        actual_model: ModelIdentity,
    },
    ModelIdentityObserved(ModelIdentity),
    TextDelta(String),
    AssistantMessageStarted {
        item_id: String,
        phase: Option<AssistantMessagePhase>,
    },
    AssistantTextDelta {
        item_id: String,
        text: String,
    },
    AssistantMessageCompleted {
        item_id: String,
        phase: Option<AssistantMessagePhase>,
    },
    ReasoningSummaryStarted {
        item_id: String,
    },
    ReasoningSummaryPartAdded {
        item_id: String,
        summary_index: crate::protocol::ReasoningSummaryIndex,
    },
    ReasoningSummaryDelta {
        item_id: String,
        summary_index: crate::protocol::ReasoningSummaryIndex,
        text: String,
    },
    OutputItemDone(Box<CompletedModelItem>),
    /// Compatibility input only: may confirm, never reorder, accepted done items.
    OutputOrder(Vec<ModelOutputItemId>),
    ToolCallStarted {
        call_id: String,
        name: String,
    },
    ToolArgumentsDelta {
        call_id: String,
        delta: String,
    },
    ToolCallCompleted {
        call_id: String,
    },
    Usage(ModelUsage),
    Completed {
        reason: FinishReason,
        end_turn: Option<bool>,
    },
}

/// A completed provider message item. Missing phase remains unknown; it is not
/// inferred from whether the surrounding response contains tool calls.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistantMessage {
    pub item_id: String,
    pub text: String,
    pub phase: Option<AssistantMessagePhase>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ModelOutputItem {
    Message(AssistantMessage),
    ReasoningSummary(super::ReasoningSummary),
    ToolCall(ToolCallIntent),
}

/// One done fact; normalized content and provider extension are accepted
/// atomically. Native-only items preserve reasoning/opaque order without
/// manufacturing an assistant message or executable tool call.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletedModelItem {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub canonical_item_id: Option<Uuid>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub normalized: Option<ModelOutputItem>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub native: Option<Box<NativeItemData>>,
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum ModelOutputItemId {
    Message(String),
    ReasoningSummary(String),
    ToolCall(String),
}

#[derive(Clone, Debug)]
pub struct ModelResponse {
    pub response_id: String,
    pub actual_model: ModelIdentity,
    /// False means `actual_model` is the requested fallback, not provider evidence.
    pub actual_model_observed: bool,
    pub text: String,
    pub output: Vec<ModelOutputItem>,
    pub tool_calls: Vec<ToolCallIntent>,
    pub usage: ModelUsage,
    pub end_turn: Option<bool>,
}

/// Safe, bounded storage evidence; never includes SQL text or provider data.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ContextPersistenceDiagnostic {
    pub conversation_id: uuid::Uuid,
    pub phase: &'static str,
    pub safe_cause: &'static str,
    pub sqlite_extended_code: Option<i32>,
}

impl std::fmt::Display for ContextPersistenceDiagnostic {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "context_persistence_failure: conversation={} phase={} cause={}",
            self.conversation_id, self.phase, self.safe_cause
        )?;
        if let Some(code) = self.sqlite_extended_code {
            write!(f, " sqlite_extended_code={code}")?;
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, thiserror::Error)]
pub enum ModelError {
    #[error("model authentication required")]
    Authentication,
    #[error("model authentication rejected with HTTP {0}")]
    HttpAuthentication(u16),
    #[error("model capability unavailable")]
    UnsupportedCapability,
    #[error("unsupported model response type")]
    UnsupportedResponseType,
    #[error("invalid model request")]
    InvalidRequest,
    #[error("model provider rejected the request")]
    ProviderRejected,
    #[error("unexpected model HTTP status {0}")]
    UnexpectedStatus(u16),
    #[error("model rate limited")]
    RateLimited,
    #[error("model rate limited with HTTP {0}")]
    HttpRateLimited(u16),
    #[error("model context window exceeded")]
    ContextWindowExceeded,
    #[error("model usage limit reached")]
    UsageLimitReached,
    #[error("model server overloaded")]
    ServerOverloaded,
    #[error("model server internal error")]
    InternalServerError,
    #[error("model temporarily unavailable")]
    Unavailable,
    /// A host-owned context accounting store failed; this is not a provider failure.
    #[error("agent context persistence unavailable")]
    Persistence,
    #[error("{0}")]
    PersistenceDiagnostic(ContextPersistenceDiagnostic),
    #[error("model request timed out")]
    TimedOut,
    #[error("model connection failed")]
    ConnectionFailed,
    #[error("model response read failed")]
    ResponseReadFailed,
    #[error("model request canceled")]
    Canceled,
    #[error("invalid model response stream")]
    InvalidStream,
    #[error("model response ended before completion")]
    IncompleteStream,
    #[error("model output was truncated")]
    Truncated,
    #[error("model output was filtered")]
    Filtered,
    #[error("model response exceeded its budget")]
    BudgetExceeded,
}

pub type ModelFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T, ModelError>> + Send + 'a>>;

/// One request owns one stream. Dropping the stream must cancel its transport;
/// adapters must not keep an HTTP reader or retry loop detached from the owner.
pub trait ModelStream: Send {
    fn next(&mut self) -> ModelFuture<'_, Option<ModelStreamEvent>>;
}
pub trait ModelTransport: Send + Sync {
    /// Freeze trusted host policy before request preparation. This port must not
    /// start inference; repeated preparation must preserve the same policy.
    fn prepare_context_policy(&self) -> ModelFuture<'_, ()> {
        Box::pin(async { Ok(()) })
    }
    /// The task owner supplies a surviving prior turn, never a guessed latest
    /// database row. Native policy may select an authorized previous-model step.
    fn pre_turn_compaction<'a>(
        &'a self,
        _previous_turn: uuid::Uuid,
        _previous_model: &'a ModelIdentity,
        _active_tokens: Option<u64>,
    ) -> ModelFuture<'a, Option<Arc<dyn crate::context::compaction_strategy::CompactionStrategy>>>
    {
        Box::pin(async { Ok(None) })
    }
    fn capabilities(&self) -> ModelCapabilities;
    /// Provider-owned protocol capability; transport decorators forward it.
    /// A false default keeps older and third-party adapters on flat catalogs.
    fn supports_namespace_tools(&self) -> bool {
        false
    }
    /// Frozen, host-verified model policy; absent means no model policy was
    /// available. It does not authorize interpreting a view as a full result.
    fn tool_output_policy(&self) -> Option<super::tool_output::ToolOutputPolicy> {
        None
    }
    /// The host already projected the initial history from authoritative facts.
    fn tool_output_history_prepared(&self) -> bool {
        false
    }
    /// Native binding/disclosure decorators revalidate frozen authority before
    /// either normal inference or compaction I/O. This must not start inference.
    fn authorize_request<'a>(&'a self, _: &'a ModelRequest) -> ModelFuture<'a, ()> {
        Box::pin(async { Ok(()) })
    }
    /// Optional strategy frozen by the native composition owner with this
    /// transport. Encoding support alone must not select a supplier policy.
    fn prepared_compaction_strategy(
        &self,
    ) -> Option<Arc<dyn crate::context::compaction_strategy::CompactionStrategy>> {
        None
    }
    /// Protocol support only. The host still injects an exact model strategy;
    /// this must not be used to infer supplier/model service capabilities.
    fn supports_compaction_kind(
        &self,
        kind: crate::context::compaction_strategy::CompactionKind,
    ) -> bool {
        kind == crate::context::compaction_strategy::CompactionKind::TextSummary
    }
    /// Optional trusted TokenBudget policy frozen with the exact-model strategy.
    /// None keeps the experimental runtime disabled; protocol support is not opt-in.
    fn token_budget_policy(&self) -> Option<Arc<crate::context::token_budget::TokenBudgetPolicy>> {
        None
    }
    /// Frozen provider/model-specific active-window policy; absent is unknown.
    fn context_accounting(&self) -> Option<Arc<crate::context::accounting::ContextAccounting>> {
        None
    }
    /// Validate a replacement using the same adapter that will sample it. Remote
    /// adapters must verify live account scope and actual protocol encoding before
    /// installation/recovery. The default only understands normalized text state.
    /// Text may retain its producer identity across model changes. The host must
    /// separately validate the injected strategy's read-compatible codec binding.
    /// Validation must not send inference or mutate installed continuation state.
    fn validate_compaction_window<'a>(
        &'a self,
        checkpoint: &'a crate::context::checkpoint::ContextCheckpoint,
        request: &'a ModelRequest,
    ) -> ModelFuture<'a, ()> {
        Box::pin(async move {
            if !matches!(
                checkpoint.output,
                crate::context::compaction_strategy::CompactionOutput::TextSummary(_)
                    | crate::context::compaction_strategy::CompactionOutput::ResetWindow
            ) || checkpoint.credential_scope_id.is_some()
            {
                return Err(ModelError::UnsupportedCapability);
            }
            checkpoint
                .validate(usize::MAX)
                .map_err(|_| ModelError::InvalidRequest)?;
            request.validate(self.capabilities())
        })
    }
    fn start(&self, request: ModelRequest) -> ModelFuture<'_, Box<dyn ModelStream>>;
    /// A textual compaction candidate is separate from ordinary continuation
    /// state. Hosts may adapt replay while keeping regular request checks strict.
    fn start_text_compaction(
        &self,
        request: ModelRequest,
    ) -> ModelFuture<'_, Box<dyn ModelStream>> {
        self.start(request)
    }
}

impl ModelRequest {
    /// Fail before transport; unsupported images/tools cannot be silently omitted.
    pub fn validate(&self, capabilities: ModelCapabilities) -> Result<(), ModelError> {
        use std::collections::HashSet;
        if let Some(captured) = &self.captured_history {
            captured.validate()?;
        }
        if self.max_output_tokens == 0
            || self.messages.is_empty()
            || self.model.model_id.trim().is_empty()
            || self.model.provider_id.trim().is_empty()
        {
            return Err(ModelError::InvalidRequest);
        }
        if (!self.tools.is_empty() && !capabilities.tools)
            || (self.parallel_tool_calls && !capabilities.parallel_tools)
        {
            return Err(ModelError::UnsupportedCapability);
        }
        if let Some(effort) = &self.reasoning_effort {
            if effort.is_empty()
                || effort.len() > 1024
                || effort.trim() != effort
                || effort.contains('\0')
            {
                return Err(ModelError::InvalidRequest);
            }
            if !capabilities.reasoning_efforts.contains(effort) {
                return Err(ModelError::UnsupportedCapability);
            }
        }
        let mut names = HashSet::new();
        for tool in &self.tools {
            if tool.name.trim().is_empty()
                || !tool.parameters.is_object()
                || !names.insert((&tool.namespace, &tool.name))
            {
                return Err(ModelError::InvalidRequest);
            }
        }
        let mut pending = HashSet::new();
        let mut used = HashSet::new();
        for message in &self.messages {
            let content = match message {
                ModelMessage::User { content, .. } | ModelMessage::Assistant { content, .. } => {
                    Some(content)
                }
                _ => None,
            };
            if let Some(content) = content {
                for part in content {
                    if let ContentPart::Image { media_type, bytes } = part {
                        if !capabilities.vision {
                            return Err(ModelError::UnsupportedCapability);
                        }
                        if bytes.is_empty()
                            || !matches!(
                                media_type.as_str(),
                                "image/png" | "image/jpeg" | "image/webp"
                            )
                        {
                            return Err(ModelError::InvalidRequest);
                        }
                    }
                }
            }
            match message {
                ModelMessage::User {
                    source_item_id: Some(id),
                    ..
                } if id.is_nil() => return Err(ModelError::InvalidRequest),
                ModelMessage::ToolResult { call_id, .. } => {
                    if !pending.remove(call_id.as_str()) {
                        return Err(ModelError::InvalidRequest);
                    }
                }
                other => {
                    // Responses may interleave several assistant message and
                    // function-call items before the host returns tool results.
                    if !pending.is_empty()
                        && !matches!(
                            other,
                            ModelMessage::Assistant { .. } | ModelMessage::CanonicalOutput(_)
                        )
                    {
                        return Err(ModelError::InvalidRequest);
                    }
                    if let ModelMessage::CanonicalOutput(item) = other {
                        item.validate().map_err(|_| ModelError::InvalidRequest)?;
                    }
                    {
                        if other.has_tool_calls() && !capabilities.tools {
                            return Err(ModelError::UnsupportedCapability);
                        }
                        if let ModelMessage::Assistant { tool_calls, .. } = other
                            && tool_calls.iter().any(|call| call.arguments_json().is_err())
                        {
                            return Err(ModelError::InvalidRequest);
                        }
                        for (call_id, name) in other.tool_call_identities() {
                            if call_id.is_empty() || name.is_empty() || !used.insert(call_id) {
                                return Err(ModelError::InvalidRequest);
                            }
                            pending.insert(call_id);
                        }
                    }
                }
            }
        }
        if !pending.is_empty() {
            return Err(ModelError::InvalidRequest);
        }
        Ok(())
    }
}
