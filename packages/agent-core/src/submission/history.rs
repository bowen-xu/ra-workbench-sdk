//! Frozen prompt input only. This type cannot stand in for a submission receipt.
use super::{SubmissionInput, SubmissionRecord};
use uuid::Uuid;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HistoricalTurnInput {
    /// Conversation whose validated history contains this turn.
    pub conversation_id: Uuid,
    /// Original owner of the immutable input, even for multi-generation forks.
    pub source_conversation_id: Uuid,
    pub turn_id: Uuid,
    pub context_snapshot_id: Uuid,
    pub input: SubmissionInput,
}
impl HistoricalTurnInput {
    pub fn from_record(conversation_id: Uuid, record: SubmissionRecord) -> Self {
        Self {
            conversation_id,
            source_conversation_id: record.conversation_id,
            turn_id: record.turn_id,
            context_snapshot_id: record.context_snapshot_id,
            input: record.input,
        }
    }
}
