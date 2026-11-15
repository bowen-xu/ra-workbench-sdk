//! Application-owned conversation metadata, separate from the event writer lease.
use super::ConversationId;
use std::{future::Future, pin::Pin};
mod mutation;
pub use mutation::{
    ArchiveConversation, ArchiveProof, ArchiveStatus, CatalogDataFailure, CatalogDataFailureKind,
    CatalogMutationDiagnostic, CatalogMutationError, CatalogMutationFuture, CatalogMutationProof,
    CatalogMutationStatus, CreateBoundConversation, CreateBoundProof, CreateBoundStatus,
    RenameConversation, RenameProof, RenameStatus,
};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ConversationSummary {
    /// App-owned generation jobs are separate from user chats.
    pub internal: bool,
    pub id: ConversationId,
    pub title: String,
    pub archived: bool,
    pub durable_count: u64,
    pub created_at: String,
    pub updated_at: String,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CatalogCursor {
    pub created_at: String,
    pub id: ConversationId,
}
#[derive(Clone, Debug)]
pub struct CatalogQuery {
    /// Select exactly one catalog; neither category leaks into the other.
    pub internal: bool,
    pub binding: Option<ConversationBinding>,
    pub archived: bool,
    pub limit: u16,
    pub before: Option<CatalogCursor>,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BindingKind {
    Manuscript,
    Paper,
    Note,
    ReadingNote,
}
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConversationBinding {
    pub kind: BindingKind,
    pub resource_id: String,
}
#[derive(Clone, Debug)]
pub struct CatalogPage {
    pub conversations: Vec<ConversationSummary>,
    pub next: Option<CatalogCursor>,
}
#[derive(Debug, PartialEq, Eq, thiserror::Error)]
pub enum CatalogError {
    #[error("invalid conversation catalog input")]
    InvalidInput,
    #[error("conversation not found")]
    NotFound,
    #[error("conversation changed since it was read")]
    Conflict,
    #[error("conversation has an unfinished turn")]
    Busy,
    #[error("conversation exceeds the validated history budget")]
    TooLarge,
    #[error("conversation catalog unavailable")]
    Unavailable,
    #[error("conversation metadata is corrupt")]
    Corrupt,
}
pub type CatalogFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T, CatalogError>> + Send + 'a>>;

/// Lists independent application conversations, never provider-owned history.
/// Rename uses the title that the caller read to avoid overwriting concurrent edits.
/// These metadata operations must not alter durable events or writer ownership.
pub trait ConversationCatalog: Send + Sync {
    /// Atomically create an empty conversation and its initial host association.
    /// Replaying an ID requires that association to already match; never adopt an
    /// unrelated existing conversation or acquire its runtime writer lease.
    fn create_bound(
        &self,
        command: CreateBoundConversation,
    ) -> CatalogMutationFuture<'_, CreateBoundProof>;
    /// Inspection never replays creation or substitutes current metadata.
    fn create_bound_status(
        &self,
        command: CreateBoundConversation,
    ) -> CatalogMutationFuture<'_, CreateBoundStatus>;
    /// Read exact metadata independently of pagination or archive filters.
    /// An optional binding must match; reading never acquires a runtime lease.
    fn read(
        &self,
        id: ConversationId,
        binding: Option<ConversationBinding>,
    ) -> CatalogFuture<'_, ConversationSummary>;
    /// Archive only a validated idle history. Restore never starts or replays work.
    /// The archive decision and event admission must be fenced against each other.
    fn set_archived(&self, command: ArchiveConversation)
    -> CatalogMutationFuture<'_, ArchiveProof>;
    fn archive_status(
        &self,
        command: ArchiveConversation,
    ) -> CatalogMutationFuture<'_, ArchiveStatus>;
    fn list(&self, query: CatalogQuery) -> CatalogFuture<'_, CatalogPage>;
    fn rename(&self, command: RenameConversation) -> CatalogMutationFuture<'_, RenameProof>;
    /// Inspect only the exact original intent; status never replays the write or
    /// refreshes current metadata and remains usable while its owner is blocked.
    fn rename_status(&self, command: RenameConversation)
    -> CatalogMutationFuture<'_, RenameStatus>;
}
