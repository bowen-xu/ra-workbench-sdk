use std::collections::HashMap;
use std::sync::{
    Mutex,
    atomic::{AtomicBool, Ordering},
};

use research_agent_core::conversation::{
    ConversationId, ConversationStore, HistoryPage, HistoryQuery, StoreError, StoreFuture,
    WriterLease,
};
use tokio::sync::{Notify, oneshot};

#[derive(Default)]
pub struct TestStore {
    state: Mutex<State>,
    pub fail_history: AtomicBool,
    pub fail_flush: AtomicBool,
    pub fail_create_after_reservation: AtomicBool,
    pub create_reserved: Notify,
    pause_create: Mutex<Option<oneshot::Receiver<()>>>,
}

#[derive(Default)]
struct State {
    committed: HashMap<ConversationId, Vec<String>>,
    writers: HashMap<ConversationId, Pending>,
    append_calls: usize,
}

struct Pending {
    lease: WriterLease,
    items: Vec<String>,
}

impl TestStore {
    pub fn pause_next_create(&self) -> oneshot::Sender<()> {
        let (tx, rx) = oneshot::channel();
        *self.pause_create.lock().unwrap() = Some(rx);
        tx
    }

    pub fn has_writer(&self, lease: WriterLease) -> bool {
        self.state
            .lock()
            .unwrap()
            .writers
            .get(&lease.conversation_id)
            .is_some_and(|pending| pending.lease == lease)
    }

    pub fn append_calls(&self) -> usize {
        self.state.lock().unwrap().append_calls
    }

    fn commit_pending(&self, lease: WriterLease, close: bool) -> Result<u64, StoreError> {
        if self.fail_flush.swap(false, Ordering::SeqCst) {
            return Err(StoreError::Unavailable);
        }
        let mut state = self.state.lock().unwrap();
        let pending = state
            .writers
            .get_mut(&lease.conversation_id)
            .filter(|pending| pending.lease == lease)
            .ok_or(StoreError::WriterConflict)?;
        let items = std::mem::take(&mut pending.items);
        let committed = state.committed.entry(lease.conversation_id).or_default();
        committed.extend(items);
        let count = committed.len() as u64;
        if close {
            state.writers.remove(&lease.conversation_id);
        }
        Ok(count)
    }
}

impl ConversationStore<String> for TestStore {
    fn reserve_writer(&self, lease: WriterLease) -> Result<(), StoreError> {
        let mut state = self.state.lock().unwrap();
        if state.writers.contains_key(&lease.conversation_id) {
            return Err(StoreError::WriterConflict);
        }
        state.writers.insert(
            lease.conversation_id,
            Pending {
                lease,
                items: vec![],
            },
        );
        Ok(())
    }

    fn create(&self, lease: WriterLease) -> StoreFuture<'_, ()> {
        Box::pin(async move {
            {
                let state = self.state.lock().unwrap();
                if state.committed.contains_key(&lease.conversation_id) {
                    return Err(StoreError::AlreadyExists);
                }
                if !state
                    .writers
                    .get(&lease.conversation_id)
                    .is_some_and(|pending| pending.lease == lease)
                {
                    return Err(StoreError::WriterConflict);
                }
            }
            self.create_reserved.notify_one();
            let wait = self.pause_create.lock().unwrap().take();
            if let Some(wait) = wait {
                wait.await.map_err(|_| StoreError::Unavailable)?;
            }
            if self
                .fail_create_after_reservation
                .swap(false, Ordering::SeqCst)
            {
                return Err(StoreError::Unavailable);
            }
            Ok(())
        })
    }

    fn resume(&self, lease: WriterLease) -> StoreFuture<'_, ()> {
        Box::pin(async move {
            let state = self.state.lock().unwrap();
            if !state.committed.contains_key(&lease.conversation_id) {
                return Err(StoreError::NotFound {
                    conversation_id: lease.conversation_id,
                });
            }
            if !state
                .writers
                .get(&lease.conversation_id)
                .is_some_and(|pending| pending.lease == lease)
            {
                return Err(StoreError::WriterConflict);
            }
            Ok(())
        })
    }

    fn append(&self, lease: WriterLease, items: Vec<String>) -> StoreFuture<'_, ()> {
        Box::pin(async move {
            let mut state = self.state.lock().unwrap();
            let pending = state
                .writers
                .get_mut(&lease.conversation_id)
                .filter(|pending| pending.lease == lease)
                .ok_or(StoreError::WriterConflict)?;
            pending.items.extend(items);
            state.append_calls += 1;
            Ok(())
        })
    }

    fn persist(&self, lease: WriterLease) -> StoreFuture<'_, u64> {
        Box::pin(async move { self.commit_pending(lease, false) })
    }

    fn flush(&self, lease: WriterLease) -> StoreFuture<'_, u64> {
        Box::pin(async move { self.commit_pending(lease, false) })
    }

    fn shutdown(&self, lease: WriterLease) -> StoreFuture<'_, u64> {
        Box::pin(async move { self.commit_pending(lease, true) })
    }

    fn discard(&self, lease: WriterLease) {
        let mut state = self.state.lock().unwrap();
        if state
            .writers
            .get(&lease.conversation_id)
            .is_some_and(|pending| pending.lease == lease)
        {
            state.writers.remove(&lease.conversation_id);
        }
    }

    fn history(&self, query: HistoryQuery) -> StoreFuture<'_, HistoryPage<String>> {
        Box::pin(async move {
            if self.fail_history.swap(false, Ordering::SeqCst) {
                return Err(StoreError::CorruptHistory);
            }
            let state = self.state.lock().unwrap();
            let items =
                state
                    .committed
                    .get(&query.conversation_id)
                    .ok_or(StoreError::NotFound {
                        conversation_id: query.conversation_id,
                    })?;
            let offset = usize::try_from(query.offset).map_err(|_| StoreError::InvalidPage)?;
            let page = items
                .iter()
                .skip(offset)
                .take(query.limit() as usize)
                .cloned()
                .collect::<Vec<_>>();
            let next = offset.saturating_add(page.len());
            Ok(HistoryPage {
                items: page,
                next_offset: (next < items.len()).then_some(next as u64),
                durable_count: items.len() as u64,
            })
        })
    }
}
