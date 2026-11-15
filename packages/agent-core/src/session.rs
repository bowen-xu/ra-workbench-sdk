//! Durable event ownership shared by every research host. No UI or model execution.

use crate::{
    conversation::{ConversationStore, HistoryQuery, LiveConversation, StoreError, WriterLease},
    protocol::{
        AgentEvent, ApplyResult, ConversationProjection, EventPayload, ProjectionError, TurnOutcome,
    },
};
use std::sync::Arc;
use uuid::Uuid;

#[derive(Debug, thiserror::Error)]
pub enum SessionError {
    #[error(transparent)]
    Storage(#[from] StoreError),
    #[error(transparent)]
    Projection(#[from] ProjectionError),
    #[error("session requires reopening after an unacknowledged write")]
    RecoveryRequired,
    #[error("invalid session event batch")]
    InvalidBatch,
}

/// A receipt is returned only after the batch becomes durable and its projection
/// is installed. Event publishers must use these receipts, never pending input.
#[derive(Debug)]
pub struct CommittedBatch {
    pub watermark: u64,
    pub events: Vec<AgentEvent>,
}

pub struct DurableConversation {
    live: LiveConversation<AgentEvent>,
    projection: ConversationProjection,
    needs_recovery: bool,
    new_context_window_requested: bool,
    token_budget_window: Option<crate::context::token_budget::TokenBudgetWindow>,
    context_window_needs_reconcile: bool,
}

impl DurableConversation {
    pub async fn create(
        store: Arc<dyn ConversationStore<AgentEvent>>,
        lease: WriterLease,
    ) -> Result<Self, SessionError> {
        let live = LiveConversation::create(store, lease).await?;
        if live.persist().await? != 0 {
            return Err(StoreError::CorruptHistory.into());
        }
        Ok(Self {
            live,
            projection: ConversationProjection::new(lease.conversation_id),
            needs_recovery: false,
            new_context_window_requested: false,
            token_budget_window: None,
            context_window_needs_reconcile: false,
        })
    }

    /// Reconstruct the exact durable prefix before accepting further writes. This
    /// does not rerun a model or tool. The service may mark an active turn interrupted.
    pub async fn resume(
        store: Arc<dyn ConversationStore<AgentEvent>>,
        lease: WriterLease,
    ) -> Result<Self, SessionError> {
        let (live, mut page) = LiveConversation::resume(store.clone(), lease, 500).await?;
        let durable_count = page.durable_count;
        let mut projection = ConversationProjection::new(lease.conversation_id);
        loop {
            let previous_seq = projection.seq();
            if page.durable_count != durable_count {
                return Err(StoreError::CorruptHistory.into());
            }
            for event in page.items {
                if projection.apply(&event)? != ApplyResult::Applied {
                    return Err(StoreError::CorruptHistory.into());
                }
            }
            match page.next_offset {
                Some(next)
                    if next == projection.seq() && next < durable_count && next > previous_seq =>
                {
                    page = store
                        .history(HistoryQuery::new(lease.conversation_id, next, 500)?)
                        .await?;
                }
                Some(_) => return Err(StoreError::CorruptHistory.into()),
                None => break,
            }
        }
        if projection.seq() != durable_count {
            return Err(StoreError::CorruptHistory.into());
        }
        Ok(Self {
            live,
            projection,
            needs_recovery: false,
            new_context_window_requested: false,
            token_budget_window: None,
            context_window_needs_reconcile: false,
        })
    }

    /// Runtime-only request state migrated from Codex SessionState. An ended
    /// turn does not clear it; reopening creates fresh state. Installation does.
    pub fn request_new_context_window(&mut self, turn: Uuid) -> Result<(), SessionError> {
        self.check_context_window_ready(turn)?;
        if let Some(window) = self.token_budget_window.as_mut() {
            window.request_new_context_window();
        } else {
            self.new_context_window_requested = true;
        }
        Ok(())
    }
    pub fn take_new_context_window_request(&mut self, turn: Uuid) -> Result<bool, SessionError> {
        self.check_context_window_ready(turn)?;
        Ok(match self.token_budget_window.as_mut() {
            Some(window) => window.take_new_context_window_request(),
            None => std::mem::take(&mut self.new_context_window_requested),
        })
    }
    pub fn clear_new_context_window_request(&mut self) {
        self.new_context_window_requested = false;
        if let Some(window) = self.token_budget_window.as_mut() {
            window.clear_new_context_window_request();
        }
    }
    fn check_context_request_owner(&self, turn: Uuid) -> Result<(), SessionError> {
        if self.needs_recovery {
            return Err(SessionError::RecoveryRequired);
        }
        if self.projection.active_turn() != Some(turn) {
            return Err(SessionError::InvalidBatch);
        }
        Ok(())
    }
    pub fn projection(&self) -> &ConversationProjection {
        &self.projection
    }
    pub fn needs_recovery(&self) -> bool {
        self.needs_recovery
    }

    /// Serialize through &mut self. Validate before any write, then publish only after
    /// flush. Cancellation sets the same recovery barrier as storage failure: it is
    /// unsafe to append a new batch until this owner is dropped and history reopened.
    pub async fn commit(
        &mut self,
        events: Vec<AgentEvent>,
    ) -> Result<CommittedBatch, SessionError> {
        if self.needs_recovery {
            return Err(SessionError::RecoveryRequired);
        }
        if events.is_empty() || events.len() > 500 {
            return Err(SessionError::InvalidBatch);
        }
        let mut candidate = self.projection.clone();
        let rolled_back = events
            .iter()
            .any(|event| matches!(event.payload(), EventPayload::ConversationRolledBack { .. }));
        for event in &events {
            if candidate.apply(event)? != ApplyResult::Applied {
                return Err(SessionError::InvalidBatch);
            }
        }
        self.needs_recovery = true;
        self.live.append(&events).await?;
        let watermark = self.live.flush().await?;
        if watermark != candidate.seq() {
            return Err(StoreError::CorruptHistory.into());
        }
        self.projection = candidate;
        self.needs_recovery = false;
        if rolled_back {
            // The host must reread the surviving chain. Preserve once claims
            // if rollback only changed its tail and kept the same window.
            self.context_window_needs_reconcile = true;
            self.clear_new_context_window_request();
        }
        Ok(CommittedBatch { watermark, events })
    }

    /// Explicit startup reconciliation; creates one durable terminal event for a
    /// previously active turn. A persisted terminal diagnostic seals as failed;
    /// other unfinished work is interrupted. No task auto-resumes.
    pub async fn interrupt_recovered_turn(
        &mut self,
        request_id: Uuid,
        timestamp_ms: u64,
    ) -> Result<Option<CommittedBatch>, SessionError> {
        if self.needs_recovery {
            return Err(SessionError::RecoveryRequired);
        }
        let Some(turn_id) = self.projection.active_turn() else {
            return Ok(None);
        };
        let outcome = if self
            .projection
            .turn(turn_id)
            .is_some_and(|turn| turn.failure.is_some())
        {
            TurnOutcome::Failed
        } else {
            TurnOutcome::Interrupted
        };
        let event = AgentEvent::new(
            self.live.lease().conversation_id,
            self.projection.seq() + 1,
            timestamp_ms,
            request_id,
            EventPayload::TurnFinished { turn_id, outcome },
        )
        .map_err(|_| SessionError::InvalidBatch)?;
        self.commit(vec![event]).await.map(Some)
    }
}

mod token_budget;
pub use token_budget::PreparedTokenBudgetDecision;
