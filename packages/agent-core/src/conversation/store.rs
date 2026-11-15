// Derived from OpenAI Codex thread-store/src/store.rs (Apache-2.0).
// Copyright 2025 OpenAI. Modifications: typed research items, writer fencing, bounded pages.
// See docs/architecture/shared-agent-codex-migration-map.md for the exact source revision.

use std::{future::Future, pin::Pin};

use super::{ConversationId, StoreError, StoreResult, WriterLease};

pub type StoreFuture<'a, T> = Pin<Box<dyn Future<Output = StoreResult<T>> + Send + 'a>>;

/// Bounded durable-history read. Positions are zero-based item ordinals.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct HistoryQuery {
    pub conversation_id: ConversationId,
    pub offset: u64,
    limit: u16,
}

impl HistoryQuery {
    pub fn new(conversation_id: ConversationId, offset: u64, limit: u16) -> StoreResult<Self> {
        if !(1..=500).contains(&limit) {
            return Err(StoreError::InvalidPage);
        }
        Ok(Self {
            conversation_id,
            offset,
            limit,
        })
    }

    pub fn limit(&self) -> u16 {
        self.limit
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HistoryPage<Item> {
    pub items: Vec<Item>,
    pub next_offset: Option<u64>,
    /// Count of committed items, not the amount buffered by a live writer.
    pub durable_count: u64,
}

/// Storage-neutral lifecycle. Each successful append keeps input order.
///
/// Implementations fence every live operation by the complete lease. Queued operations
/// cannot begin committing after cancellation/discard. A commit that already won the
/// race may finish without acknowledgement; resume must reconcile durable history.
/// Append queues items; persist/flush atomically publish queued items and metadata.
/// A failed flush retains the pending batch for retry without partial duplication.
/// IO is owned by the adapter; do not hold a database transaction across a network await.
pub trait ConversationStore<Item>: Send + Sync {
    /// Atomically reserve the live writer before any fallible asynchronous opening.
    /// Reject an occupied conversation even if the supplied writer ID is the same.
    /// This is memory-only; failed reservation does not own or discard the incumbent.
    fn reserve_writer(&self, lease: WriterLease) -> StoreResult<()>;

    /// Initialize an unused conversation using a reserved writer; lazy until persist.
    fn create(&self, lease: WriterLease) -> StoreFuture<'_, ()>;

    /// Open an existing durable conversation using the already reserved writer.
    fn resume(&self, lease: WriterLease) -> StoreFuture<'_, ()>;

    /// Append a batch atomically to the pending writer. Empty batches are no-ops.
    fn append(&self, lease: WriterLease, items: Vec<Item>) -> StoreFuture<'_, ()>;

    /// Materialize lazy metadata and commit pending items. Return the durable count.
    fn persist(&self, lease: WriterLease) -> StoreFuture<'_, u64>;

    /// Commit pending items. Return only once they are readable through history.
    fn flush(&self, lease: WriterLease) -> StoreFuture<'_, u64>;

    /// Flush and close the writer. Failed shutdown leaves the writer available for retry.
    fn shutdown(&self, lease: WriterLease) -> StoreFuture<'_, u64>;

    /// Release matching in-memory writer/pending items; leave durable data intact.
    ///
    /// Infallible, idempotent, non-IO cleanup used from Drop, including canceled opens.
    /// A stale lease MUST NOT close a newer writer. No detached async cleanup tasks.
    fn discard(&self, lease: WriterLease);

    /// Read committed history only. A lazy/unpersisted conversation is not found.
    fn history(&self, query: HistoryQuery) -> StoreFuture<'_, HistoryPage<Item>>;
}
