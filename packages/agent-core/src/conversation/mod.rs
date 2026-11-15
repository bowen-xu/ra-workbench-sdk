//! Storage-neutral persistence lifecycle adapted from the pinned Codex thread-store.

mod catalog;
mod deletion;
mod error;
mod export;
mod fork;
mod identity;
mod live;
mod search;
mod store;

pub use catalog::{
    ArchiveConversation, ArchiveProof, ArchiveStatus, BindingKind, CatalogCursor,
    CatalogDataFailure, CatalogDataFailureKind, CatalogError, CatalogFuture,
    CatalogMutationDiagnostic, CatalogMutationError, CatalogMutationFuture, CatalogMutationProof,
    CatalogMutationStatus, CatalogPage, CatalogQuery, ConversationBinding, ConversationCatalog,
    ConversationSummary, CreateBoundConversation, CreateBoundProof, CreateBoundStatus,
    RenameConversation, RenameProof, RenameStatus,
};
pub use deletion::{
    ConversationDeletionError, ConversationDeletionFuture, ConversationDeletionReceipt,
    ConversationDeletionRequest, ConversationDeletionStore, ConversationRetention,
};
pub use error::{StoreError, StoreResult};
pub use export::{
    ConversationExport, ConversationExportError, ExportAttempt, ExportItem, ExportItemKind,
    ExportMetadata, ExportTurn,
};
pub use fork::{
    ConversationFork, ConversationForkOrigin, ConversationForkReader, ConversationForkRequest,
    ConversationForkStore, completed_fork_boundary, materialize_fork_history,
};
pub use identity::{ConversationId, WriterId, WriterLease, child_submission_request_id};
pub use live::LiveConversation;
pub use search::{
    ConversationSearch, ConversationSearchHit, ConversationSearchPage, ConversationSearchQuery,
};
pub use store::{ConversationStore, HistoryPage, HistoryQuery, StoreFuture};
