// Derived from OpenAI Codex thread-store/src/live_thread.rs (Apache-2.0).
// Copyright 2025 OpenAI. Modifications: lease ownership and synchronous discard guard;
// no Codex metadata projection, local-path downcast, telemetry or spawned Drop task.

use std::sync::Arc;

use super::{ConversationStore, HistoryPage, HistoryQuery, StoreResult, WriterLease};

/// Owns one active writer. Explicit shutdown flushes; dropping only discards pending work.
///
/// Create/resume install the guard BEFORE opening storage so canceling initialization
/// releases the attempted writer. Store leases prevent this cleanup affecting a successor.
/// Durable data must be flushed explicitly before acknowledging it to a user.
pub struct LiveConversation<Item> {
    store: Arc<dyn ConversationStore<Item>>,
    lease: WriterLease,
    closed: bool,
}

impl<Item: Clone + Send + Sync + 'static> LiveConversation<Item> {
    pub async fn create(
        store: Arc<dyn ConversationStore<Item>>,
        lease: WriterLease,
    ) -> StoreResult<Self> {
        store.reserve_writer(lease)?;
        let live = Self {
            store,
            lease,
            closed: false,
        };
        live.store.create(lease).await?;
        Ok(live)
    }

    /// Load the first durable page while reopening. Failure discards the new writer.
    pub async fn resume(
        store: Arc<dyn ConversationStore<Item>>,
        lease: WriterLease,
        page_size: u16,
    ) -> StoreResult<(Self, HistoryPage<Item>)> {
        let query = HistoryQuery::new(lease.conversation_id, 0, page_size)?;
        store.reserve_writer(lease)?;
        let live = Self {
            store,
            lease,
            closed: false,
        };
        live.store.resume(lease).await?;
        let history = live.store.history(query).await?;
        Ok((live, history))
    }

    pub fn lease(&self) -> WriterLease {
        self.lease
    }

    pub async fn append(&self, items: &[Item]) -> StoreResult<()> {
        // Preserve Codex's empty-append rule; it is not a zero-sized persistence batch.
        if items.is_empty() {
            return Ok(());
        }
        self.store.append(self.lease, items.to_vec()).await
    }

    pub async fn persist(&self) -> StoreResult<u64> {
        self.store.persist(self.lease).await
    }

    pub async fn flush(&self) -> StoreResult<u64> {
        self.store.flush(self.lease).await
    }

    /// Consumes the owner on success. Returns it with the error on failure for explicit retry.
    pub async fn shutdown(mut self) -> Result<u64, (Self, super::StoreError)> {
        match self.store.shutdown(self.lease).await {
            Ok(count) => {
                self.closed = true;
                Ok(count)
            }
            Err(error) => Err((self, error)),
        }
    }

    pub fn discard(mut self) {
        self.store.discard(self.lease);
        self.closed = true;
    }
}

impl<Item> Drop for LiveConversation<Item> {
    fn drop(&mut self) {
        if !self.closed {
            self.store.discard(self.lease);
        }
    }
}
