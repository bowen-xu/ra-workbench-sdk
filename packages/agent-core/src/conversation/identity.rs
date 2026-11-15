use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Version 2 child-creation facts freeze this identity before tool execution.
pub fn child_submission_request_id(child_id: Uuid) -> Uuid {
    Uuid::new_v5(&child_id, b"agent.child.submission:v1")
}

/// Application conversation identity, independent of provider thread identifiers.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ConversationId(Uuid);

impl ConversationId {
    pub fn from_uuid(value: Uuid) -> Self {
        Self(value)
    }

    pub fn as_uuid(&self) -> &Uuid {
        &self.0
    }
}

/// Unique identity of one opening attempt, never reused when resuming a conversation.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct WriterId(Uuid);

impl WriterId {
    pub fn from_uuid(value: Uuid) -> Self {
        Self(value)
    }
}

/// Fences stale handles from a later owner of the same conversation.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct WriterLease {
    pub conversation_id: ConversationId,
    pub writer_id: WriterId,
}
