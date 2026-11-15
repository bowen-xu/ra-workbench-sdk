use crate::conversation::{ConversationBinding, ConversationId, CreateBoundConversation};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Shared by model admission so event capacity failures are not storage errors.
pub const MAX_EVENT_NAME_CHARS: usize = 256;

const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

fn namespace_metadata_bytes(namespace: Option<&str>) -> usize {
    namespace.map_or(0, |value| {
        serde_json::to_vec(value).map_or(usize::MAX, |bytes| bytes.len())
    })
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModelIdentity {
    pub provider_id: String,
    pub model_id: String,
    pub revision: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TurnPhase {
    Preparing,
    RunningModel,
    RunningTools,
    AwaitingInput,
    AwaitingApproval,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TurnOutcome {
    Completed,
    Failed,
    Canceled,
    Interrupted,
}

/// Fixed Codex TaskKind boundary: automatic compaction remains Regular;
/// an explicit compact command owns a non-steerable task.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TaskKind {
    #[default]
    Regular,
    Compact,
}
impl TaskKind {
    pub fn is_regular(&self) -> bool {
        *self == Self::Regular
    }
}

/// The user-visible role of an assistant text item inside a turn. A turn may
/// contain several items with different phases; phase is item metadata and
/// never a reason to merge two item IDs.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AssistantMessagePhase {
    Commentary,
    Reasoning,
    FinalAnswer,
}

/// Stable, user-safe failure classification for diagnostics and retry UI.
/// The message remains a bounded human-readable detail; callers must not infer
/// recovery behavior from provider-specific error text.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FailureCategory {
    Admission,
    ToolRound,
    Persistence,
    Recovery,
    Provider,
    ProviderTemporaryUnavailable,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ItemKind {
    /// Compaction lifecycle only; never model-generated text or a tool result.
    ContextCompaction,
    UserMessage,
    /// Hook feedback is model input, but is not a user-turn boundary.
    HookPrompt {
        invocation_id: Uuid,
        fragments: Vec<HookPromptFragment>,
    },
    AssistantMessage,
    ReasoningSummary {
        parts: Vec<super::ReasoningSummaryPart>,
    },
    ProviderNative {
        item_type: String,
    },
    ToolCall {
        call_id: Uuid,
        name: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        provider_call_id: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        namespace: Option<String>,
    },
    ToolResult {
        call_id: Uuid,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        is_error: Option<bool>,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HookPromptFragment {
    pub run_id: Uuid,
    /// The exact serialized upstream hook_prompt input text.
    pub input_text: String,
}

/// Frozen when an output item is accepted, before any tool side effect starts.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CanonicalItemSource {
    pub attempt_id: Uuid,
    pub ordinal: u32,
    pub provider_item_id: Option<String>,
    pub provider_data_json: Option<String>,
}

impl std::fmt::Debug for CanonicalItemSource {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CanonicalItemSource")
            .field("attempt_id", &self.attempt_id)
            .field("ordinal", &self.ordinal)
            .field("provider_item_id", &self.provider_item_id)
            .field(
                "provider_data_json",
                &self.provider_data_json.as_ref().map(|_| "[redacted]"),
            )
            .finish()
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum EventPayload {
    /// Append-only history rollback; last turn identity guards stale commands.
    /// This does not undo tools or external side effects.
    ConversationRolledBack {
        turn_id: Uuid,
        user_turns: u32,
    },
    ModelRequestStarted {
        turn_id: Uuid,
        attempt_id: Uuid,
        model: ModelIdentity,
    },
    /// Opts this attempt into ordering model output before its in-stream tool results.
    ModelOutputInterleavingStarted {
        turn_id: Uuid,
        attempt_id: Uuid,
    },
    ModelResponseStarted {
        turn_id: Uuid,
        attempt_id: Uuid,
        response_id: String,
        model: Option<ModelIdentity>,
    },
    ModelIdentityObserved {
        turn_id: Uuid,
        attempt_id: Uuid,
        model: ModelIdentity,
    },
    ModelRequestFinished {
        turn_id: Uuid,
        attempt_id: Uuid,
        input_tokens: Option<u64>,
        output_tokens: Option<u64>,
    },
    /// Standalone compaction completed without a provider response identity.
    ModelCompactionFinished {
        turn_id: Uuid,
        attempt_id: Uuid,
        input_tokens: Option<u64>,
        output_tokens: Option<u64>,
    },
    ModelRequestFailed {
        turn_id: Uuid,
        attempt_id: Uuid,
        error: String,
        retryable: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        category: Option<FailureCategory>,
    },
    TurnStarted {
        turn_id: Uuid,
        context_snapshot_id: Uuid,
        model: ModelIdentity,
        #[serde(default, skip_serializing_if = "TaskKind::is_regular")]
        task_kind: TaskKind,
    },
    PhaseChanged {
        turn_id: Uuid,
        phase: TurnPhase,
    },
    ItemStarted {
        turn_id: Uuid,
        item_id: Uuid,
        kind: ItemKind,
    },
    /// One journal record accepts the complete body, identity, order and phase.
    /// An existing streamed draft with this ID is completed by the same record.
    ItemAccepted {
        turn_id: Uuid,
        item_id: Uuid,
        kind: ItemKind,
        text: String,
        phase: Option<AssistantMessagePhase>,
        source: Option<CanonicalItemSource>,
    },
    ItemPhaseChanged {
        turn_id: Uuid,
        item_id: Uuid,
        phase: AssistantMessagePhase,
        /// Legacy entries contain a presentation inference, not provider data.
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        native: bool,
    },
    /// Restore provider output order after the complete response and tool intents
    /// validate. Physical journal positions and tool results are unchanged.
    ModelOutputOrder {
        turn_id: Uuid,
        item_ids: Vec<Uuid>,
    },
    TextDelta {
        turn_id: Uuid,
        item_id: Uuid,
        text: String,
    },
    ReasoningSummaryPartAdded {
        turn_id: Uuid,
        item_id: Uuid,
        summary_index: super::ReasoningSummaryIndex,
    },
    ReasoningSummaryDelta {
        turn_id: Uuid,
        item_id: Uuid,
        summary_index: super::ReasoningSummaryIndex,
        text: String,
    },
    ItemCompleted {
        turn_id: Uuid,
        item_id: Uuid,
    },
    /// Frozen before a child creation side effect, bound to an accepted tool call.
    ChildCreationPrepared {
        turn_id: Uuid,
        call_id: Uuid,
        version: u8,
        child_id: Uuid,
        operation_id: Uuid,
        binding: ConversationBinding,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        submission_request_id: Option<Uuid>,
    },
    /// The result owner must acknowledge delivery before this call is safe to resume.
    ToolReceiptPending {
        turn_id: Uuid,
        call_id: Uuid,
    },
    /// The owner acknowledged delivery of the already-completed result.
    ToolReceiptConfirmed {
        turn_id: Uuid,
        call_id: Uuid,
    },
    Usage {
        turn_id: Uuid,
        input_tokens: Option<u64>,
        output_tokens: Option<u64>,
    },
    /// Terminal diagnostic, followed by TurnFinished(Failed). No model attempt
    /// is fabricated for a tool, budget or host failure.
    TurnFailed {
        turn_id: Uuid,
        error: String,
        category: FailureCategory,
    },
    TurnFinished {
        turn_id: Uuid,
        outcome: TurnOutcome,
    },
}

impl EventPayload {
    pub fn turn_id(&self) -> Uuid {
        match self {
            Self::ConversationRolledBack { turn_id, .. } => *turn_id,
            Self::TurnStarted { turn_id, .. }
            | Self::ModelRequestStarted { turn_id, .. }
            | Self::ModelOutputInterleavingStarted { turn_id, .. }
            | Self::ModelResponseStarted { turn_id, .. }
            | Self::ModelIdentityObserved { turn_id, .. }
            | Self::ModelRequestFinished { turn_id, .. }
            | Self::ModelCompactionFinished { turn_id, .. }
            | Self::ModelRequestFailed { turn_id, .. }
            | Self::PhaseChanged { turn_id, .. }
            | Self::ItemStarted { turn_id, .. }
            | Self::ItemAccepted { turn_id, .. }
            | Self::ItemPhaseChanged { turn_id, .. }
            | Self::ModelOutputOrder { turn_id, .. }
            | Self::TextDelta { turn_id, .. }
            | Self::ReasoningSummaryPartAdded { turn_id, .. }
            | Self::ReasoningSummaryDelta { turn_id, .. }
            | Self::ItemCompleted { turn_id, .. }
            | Self::ChildCreationPrepared { turn_id, .. }
            | Self::ToolReceiptPending { turn_id, .. }
            | Self::ToolReceiptConfirmed { turn_id, .. }
            | Self::Usage { turn_id, .. }
            | Self::TurnFailed { turn_id, .. }
            | Self::TurnFinished { turn_id, .. } => *turn_id,
        }
    }
}

/// Validated wire envelope. Construction and deserialization use the same checks.
/// seq is one-based; timestampMs is Unix milliseconds, both exact in JavaScript.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", try_from = "UncheckedEvent")]
pub struct AgentEvent {
    schema_version: u16,
    conversation_id: ConversationId,
    seq: u64,
    timestamp_ms: u64,
    request_id: Uuid,
    payload: EventPayload,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct UncheckedEvent {
    schema_version: u16,
    conversation_id: ConversationId,
    seq: u64,
    timestamp_ms: u64,
    request_id: Uuid,
    payload: EventPayload,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, thiserror::Error)]
pub enum EventError {
    #[error("unsupported agent event schema")]
    UnsupportedSchema,
    #[error("invalid agent event")]
    InvalidEvent,
}

impl TryFrom<UncheckedEvent> for AgentEvent {
    type Error = EventError;
    fn try_from(value: UncheckedEvent) -> Result<Self, Self::Error> {
        if value.schema_version != 1 {
            return Err(EventError::UnsupportedSchema);
        }
        Self::new(
            value.conversation_id,
            value.seq,
            value.timestamp_ms,
            value.request_id,
            value.payload,
        )
    }
}

impl AgentEvent {
    pub fn new(
        conversation_id: ConversationId,
        seq: u64,
        timestamp_ms: u64,
        request_id: Uuid,
        payload: EventPayload,
    ) -> Result<Self, EventError> {
        if seq == 0 || seq > MAX_SAFE_INTEGER || timestamp_ms > MAX_SAFE_INTEGER {
            return Err(EventError::InvalidEvent);
        }
        let valid_name =
            |value: &str| !value.trim().is_empty() && value.chars().count() <= MAX_EVENT_NAME_CHARS;
        let valid = match &payload {
            EventPayload::ChildCreationPrepared {
                turn_id,
                call_id,
                version,
                child_id,
                operation_id,
                binding,
                submission_request_id,
            } => {
                ((*version == 1 && submission_request_id.is_none())
                    || (*version == 2
                        && *submission_request_id
                            == Some(crate::conversation::child_submission_request_id(*child_id))))
                    && !turn_id.is_nil()
                    && !call_id.is_nil()
                    && CreateBoundConversation {
                        operation_id: *operation_id,
                        id: ConversationId::from_uuid(*child_id),
                        binding: binding.clone(),
                    }
                    .validate()
                    .is_ok()
            }
            EventPayload::ToolReceiptPending { turn_id, call_id }
            | EventPayload::ToolReceiptConfirmed { turn_id, call_id } => {
                !turn_id.is_nil() && !call_id.is_nil()
            }
            EventPayload::ModelOutputInterleavingStarted {
                turn_id,
                attempt_id,
            } => !turn_id.is_nil() && !attempt_id.is_nil(),
            EventPayload::ConversationRolledBack {
                turn_id,
                user_turns,
            } => !turn_id.is_nil() && *user_turns > 0,
            EventPayload::ModelResponseStarted {
                model, response_id, ..
            } => {
                valid_name(response_id)
                    && model.as_ref().is_none_or(|model| {
                        valid_name(&model.provider_id)
                            && valid_name(&model.model_id)
                            && model.revision.as_deref().is_none_or(valid_name)
                    })
            }
            EventPayload::TurnStarted { model, .. }
            | EventPayload::ModelIdentityObserved { model, .. }
            | EventPayload::ModelRequestStarted { model, .. } => {
                valid_name(&model.provider_id)
                    && valid_name(&model.model_id)
                    && model.revision.as_deref().is_none_or(valid_name)
            }
            EventPayload::ItemStarted {
                kind: ItemKind::ProviderNative { .. },
                ..
            } => false,
            EventPayload::ItemStarted {
                kind: ItemKind::HookPrompt { .. },
                ..
            } => false,
            EventPayload::ItemStarted {
                kind: ItemKind::ReasoningSummary { parts },
                ..
            } => parts.is_empty(),
            EventPayload::ItemStarted {
                kind:
                    ItemKind::ToolCall {
                        name,
                        provider_call_id,
                        namespace,
                        ..
                    },
                ..
            } => {
                valid_name(name)
                    && provider_call_id.as_deref().is_none_or(valid_name)
                    && namespace_metadata_bytes(namespace.as_deref())
                        <= super::MAX_NATIVE_ITEM_BYTES
            }
            EventPayload::TextDelta { text, .. } => {
                !text.is_empty() && text.chars().count() <= 65_536
            }
            EventPayload::ReasoningSummaryPartAdded { item_id, .. } => !item_id.is_nil(),
            EventPayload::ReasoningSummaryDelta { item_id, text, .. } => {
                !item_id.is_nil() && !text.is_empty() && text.chars().count() <= 65_536
            }
            EventPayload::ItemAccepted {
                item_id,
                kind,
                text,
                phase,
                source,
                ..
            } => {
                !item_id.is_nil()
                    && text.len() <= 16 * 1024 * 1024
                    && !matches!(kind, ItemKind::UserMessage | ItemKind::ContextCompaction)
                    && (phase.is_none() || matches!(kind, ItemKind::AssistantMessage))
                    && *phase != Some(AssistantMessagePhase::Reasoning)
                    && match kind {
                        ItemKind::ToolCall {
                            call_id,
                            name,
                            provider_call_id,
                            namespace,
                        } => {
                            !call_id.is_nil()
                                && valid_name(name)
                                && provider_call_id.as_deref().is_none_or(valid_name)
                                && namespace_metadata_bytes(namespace.as_deref())
                                    .checked_add(
                                        source
                                            .as_ref()
                                            .and_then(|source| source.provider_data_json.as_ref())
                                            .map_or(0, String::len),
                                    )
                                    .is_some_and(|bytes| bytes <= super::MAX_NATIVE_ITEM_BYTES)
                        }
                        ItemKind::ToolResult { call_id, .. } => !call_id.is_nil(),
                        ItemKind::HookPrompt {
                            invocation_id,
                            fragments,
                        } => {
                            let mut runs = std::collections::HashSet::new();
                            !invocation_id.is_nil()
                                && !fragments.is_empty()
                                && fragments.len() <= 32
                                && text.is_empty()
                                && source.is_none()
                                && fragments.iter().all(|part| {
                                    !part.run_id.is_nil()
                                        && runs.insert(part.run_id)
                                        && !part.input_text.is_empty()
                                })
                                && serde_json::to_vec(fragments)
                                    .is_ok_and(|bytes| bytes.len() <= super::MAX_NATIVE_ITEM_BYTES)
                        }
                        ItemKind::ReasoningSummary { parts } => {
                            super::validate_summary_parts(text, parts)
                                && serde_json::to_vec(parts)
                                    .ok()
                                    .and_then(|bytes| {
                                        bytes.len().checked_add(
                                            source
                                                .as_ref()
                                                .and_then(|source| {
                                                    source.provider_data_json.as_ref()
                                                })
                                                .map_or(0, String::len),
                                        )
                                    })
                                    .is_some_and(|bytes| bytes <= super::MAX_NATIVE_ITEM_BYTES)
                        }
                        ItemKind::ProviderNative { item_type } => {
                            text.is_empty()
                                && phase.is_none()
                                && !matches!(item_type.as_str(), "message" | "function_call")
                                && source
                                    .as_ref()
                                    .and_then(|value| value.provider_data_json.as_deref())
                                    .and_then(|json| super::NativeItemData::from_json(json).ok())
                                    .is_some_and(|native| native.item_type == *item_type)
                        }
                        _ => true,
                    }
                    && source.as_ref().is_none_or(|source| {
                        !source.attempt_id.is_nil()
                            && source.provider_item_id.as_deref().is_none_or(valid_name)
                            && source.provider_data_json.as_deref().is_none_or(|json| {
                                json.len() <= 16 * 1024 * 1024
                                    && serde_json::from_str::<serde_json::Value>(json).is_ok()
                            })
                    })
            }
            EventPayload::ModelOutputOrder { item_ids, .. } => {
                !item_ids.is_empty()
                    && item_ids.len() <= 500
                    && item_ids.iter().all(|id| !id.is_nil())
                    && item_ids
                        .iter()
                        .collect::<std::collections::BTreeSet<_>>()
                        .len()
                        == item_ids.len()
            }
            EventPayload::ItemPhaseChanged {
                phase,
                native: true,
                ..
            } => *phase != AssistantMessagePhase::Reasoning,
            EventPayload::ModelRequestFailed { error, .. }
            | EventPayload::TurnFailed { error, .. } => {
                !error.trim().is_empty()
                    && error.chars().count() <= 1_024
                    && !error.chars().any(char::is_control)
            }
            EventPayload::Usage {
                input_tokens,
                output_tokens,
                ..
            }
            | EventPayload::ModelRequestFinished {
                input_tokens,
                output_tokens,
                ..
            }
            | EventPayload::ModelCompactionFinished {
                input_tokens,
                output_tokens,
                ..
            } => {
                input_tokens.is_none_or(|v| v <= MAX_SAFE_INTEGER)
                    && output_tokens.is_none_or(|v| v <= MAX_SAFE_INTEGER)
            }
            _ => true,
        };
        if !valid {
            return Err(EventError::InvalidEvent);
        }
        Ok(Self {
            schema_version: 1,
            conversation_id,
            seq,
            timestamp_ms,
            request_id,
            payload,
        })
    }
    pub fn conversation_id(&self) -> ConversationId {
        self.conversation_id
    }
    pub fn seq(&self) -> u64 {
        self.seq
    }
    pub fn request_id(&self) -> Uuid {
        self.request_id
    }
    pub fn payload(&self) -> &EventPayload {
        &self.payload
    }
    pub(crate) fn inherited_by(&self, conversation_id: ConversationId) -> Self {
        Self {
            conversation_id,
            ..self.clone()
        }
    }
}
