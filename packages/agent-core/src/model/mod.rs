//! Replaceable model transport and normalized streaming response assembly.
mod completed;
mod history;
mod reasoning;
pub use reasoning::ReasoningSummary;
mod stream;
mod tool_intent;
pub mod tool_output;
mod types;
pub use history::{
    HistoryError, history_tool_call_id, reconstruct_history, reconstruct_history_after_checkpoint,
    reconstruct_history_for_continuation, reconstruct_history_for_continuation_with_user_context,
    reconstruct_history_with_context, reconstruct_history_with_developer_context,
    reconstruct_history_with_developer_fragments,
};
pub use stream::{ResponseAssembler, StreamLimits};
pub use tool_intent::ToolCallParseError;
pub use types::*;
