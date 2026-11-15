//! Application event wire format and deterministic conversation projection.
//! Inspired by the pinned Codex turn/item event split; not Codex protocol compatible.

mod event;
mod native_item;
mod projection;
mod reasoning;
pub use reasoning::{
    ReasoningSummaryDraft, ReasoningSummaryIndex, ReasoningSummaryIndexError, ReasoningSummaryPart,
    validate_summary_parts,
};

pub use event::{
    AgentEvent, AssistantMessagePhase, CanonicalItemSource, EventError, EventPayload,
    FailureCategory, HookPromptFragment, ItemKind, MAX_EVENT_NAME_CHARS, ModelIdentity, TaskKind,
    TurnOutcome, TurnPhase,
};
pub use native_item::{
    MAX_NATIVE_ITEM_BYTES, NATIVE_ITEM_SCHEMA_VERSION, NativeItemData, NativeItemError,
};
pub use projection::{
    ApplyResult, ConversationProjection, ItemProjection, ModelAttemptProjection, ProjectionError,
    TurnProjection,
};
