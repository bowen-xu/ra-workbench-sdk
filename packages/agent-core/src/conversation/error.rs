// Derived from OpenAI Codex thread-store/src/error.rs (Apache-2.0).
// Copyright 2025 OpenAI. Modifications: application identity and stable error categories.
// Source revision and adaptation notes: docs/architecture/shared-agent-codex-migration-map.md

use super::ConversationId;

pub type StoreResult<T> = Result<T, StoreError>;

/// Stable categories only: adapters must not place SQL, credentials or content in errors.
#[derive(Debug, PartialEq, Eq, thiserror::Error)]
pub enum StoreError {
    #[error("conversation not found")]
    NotFound { conversation_id: ConversationId },
    #[error("conversation already exists")]
    AlreadyExists,
    #[error("conversation writer conflict")]
    WriterConflict,
    #[error("invalid history page request")]
    InvalidPage,
    #[error("invalid conversation batch")]
    InvalidBatch,
    #[error("conversation storage unavailable")]
    Unavailable,
    /// Adapters supply only safe diagnostics and public operation identifiers.
    #[error("data_persistence_failed: {diagnostic}")]
    Persistence { diagnostic: String },
    #[error("conversation history is corrupt")]
    CorruptHistory,
}
