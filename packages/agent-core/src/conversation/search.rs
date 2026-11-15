//! Searchable history contains visible messages, never provider or tool internals.
use super::{CatalogCursor, CatalogFuture, CatalogQuery, ConversationSummary};
use uuid::Uuid;

#[derive(Clone, Debug)]
pub struct ConversationSearchQuery {
    pub term: String,
    pub scope: CatalogQuery,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ConversationSearchHit {
    pub conversation: ConversationSummary,
    /// A plain-text excerpt; hosts must not interpret it as markup or instructions.
    pub excerpt: String,
    /// None means a title match. Otherwise identifies the first matching visible message.
    pub item_id: Option<Uuid>,
    pub turn_id: Option<Uuid>,
    /// One-based durable event sequence of the message start (not a display row number).
    pub start_seq: Option<u64>,
    pub completed: bool,
}
#[derive(Clone, Debug)]
pub struct ConversationSearchPage {
    pub hits: Vec<ConversationSearchHit>,
    pub next: Option<CatalogCursor>,
}
pub trait ConversationSearch: Send + Sync {
    /// Search persisted titles and user/assistant text. Does not open or repair a runtime.
    /// Term is literal text; adapters must not interpret it as SQL, regex, or instructions.
    fn search(&self, query: ConversationSearchQuery) -> CatalogFuture<'_, ConversationSearchPage>;
}
