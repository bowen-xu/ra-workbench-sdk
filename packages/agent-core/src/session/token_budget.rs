//! Window state belongs to the same fenced session as journal admission. The
//! host supplies persisted identities; no storage, UUID generation or reset I/O.
//! Ownership adapted from Codex state/auto_compact_window.rs (Apache-2.0),
//! e363b08c9175ac1cbe5893615dd2cb9ddf95043b. Copyright 2025 OpenAI.
use super::{DurableConversation, SessionError, WriterLease};
use crate::context::token_budget::{
    TokenBudgetDecision, TokenBudgetPolicy, TokenBudgetStatus, TokenBudgetTransition,
    TokenBudgetWindow,
};
use uuid::Uuid;

pub struct PreparedTokenBudgetDecision {
    lease: WriterLease,
    turn: Uuid,
    transition: TokenBudgetTransition,
}
impl PreparedTokenBudgetDecision {
    pub fn decision(&self) -> &TokenBudgetDecision {
        self.transition.decision()
    }
}

impl DurableConversation {
    /// Same ambiguous-write barrier as journal commit. The caller holds its
    /// owner lock; dropping this future cannot leave the live owner writable.
    pub async fn persist_post_sampling_token_budget(
        &mut self,
        turn: Uuid,
        prepared: PreparedTokenBudgetDecision,
        persist: impl std::future::Future<Output = Result<(), SessionError>>,
    ) -> Result<TokenBudgetDecision, SessionError> {
        self.check_context_window_ready(turn)?;
        if prepared.turn != turn || prepared.lease != self.live.lease() {
            return Err(SessionError::InvalidBatch);
        }
        let mut candidate = self
            .token_budget_window
            .clone()
            .ok_or(SessionError::InvalidBatch)?;
        let decision = candidate
            .commit_post_sampling(prepared.transition)
            .map_err(|_| SessionError::InvalidBatch)?;
        self.needs_recovery = true;
        persist.await?;
        self.token_budget_window = Some(candidate);
        self.needs_recovery = false;
        Ok(decision)
    }
    pub(super) fn check_context_window_ready(&self, turn: Uuid) -> Result<(), SessionError> {
        self.check_context_request_owner(turn)?;
        if self.context_window_needs_reconcile && self.token_budget_window.is_some() {
            return Err(SessionError::InvalidBatch);
        }
        Ok(())
    }
    pub fn has_token_budget_window(&self) -> bool {
        self.token_budget_window.is_some()
    }
    /// Initialize once per live owner. Repeated preparation cannot reset once
    /// claims. Resume starts without state and requires the host's saved IDs.
    /// A committed rollback permits reconciliation to a different saved chain.
    pub fn restore_token_budget_window(
        &mut self,
        turn: Uuid,
        number: u64,
        first: Uuid,
        previous: Option<Uuid>,
        current: Uuid,
    ) -> Result<(), SessionError> {
        self.check_context_request_owner(turn)?;
        if let Some(window) = self.token_budget_window.as_ref() {
            if (
                window.number(),
                window.first_id(),
                window.previous_id(),
                window.id(),
            ) == (number, first, previous, current)
            {
                self.context_window_needs_reconcile = false;
                return Ok(());
            }
            if !self.context_window_needs_reconcile {
                return Err(SessionError::InvalidBatch);
            }
        }
        let mut window = TokenBudgetWindow::restore(number, first, previous, current)
            .map_err(|_| SessionError::InvalidBatch)?;
        if std::mem::take(&mut self.new_context_window_requested) {
            window.request_new_context_window();
        }
        self.token_budget_window = Some(window);
        self.context_window_needs_reconcile = false;
        Ok(())
    }

    /// Only a successful new checkpoint install may advance. Replays are
    /// handled by the host and must never call this or clear later requests.
    pub fn advance_token_budget_window(
        &mut self,
        turn: Uuid,
        expected: Uuid,
        next: Uuid,
    ) -> Result<(), SessionError> {
        self.check_context_window_ready(turn)?;
        let window = self
            .token_budget_window
            .as_mut()
            .ok_or(SessionError::InvalidBatch)?;
        if window.id() != expected {
            return Err(SessionError::InvalidBatch);
        }
        window.advance(next).map_err(|_| SessionError::InvalidBatch)
    }

    pub fn post_sampling_token_budget(
        &mut self,
        turn: Uuid,
        expected: Uuid,
        policy: &TokenBudgetPolicy,
        status: TokenBudgetStatus,
        needs_follow_up: bool,
    ) -> Result<TokenBudgetDecision, SessionError> {
        let prepared = self.prepare_post_sampling_token_budget(
            turn,
            expected,
            policy,
            status,
            needs_follow_up,
        )?;
        self.commit_post_sampling_token_budget(turn, prepared)
    }

    /// Prepare under the same owner lock held through host persistence. No
    /// runtime claim changes until commit; a failed host write drops this value.
    pub fn prepare_post_sampling_token_budget(
        &self,
        turn: Uuid,
        expected: Uuid,
        policy: &TokenBudgetPolicy,
        status: TokenBudgetStatus,
        needs_follow_up: bool,
    ) -> Result<PreparedTokenBudgetDecision, SessionError> {
        self.check_context_window_ready(turn)?;
        let window = self
            .token_budget_window
            .as_ref()
            .ok_or(SessionError::InvalidBatch)?;
        if window.id() != expected {
            return Err(SessionError::InvalidBatch);
        }
        Ok(PreparedTokenBudgetDecision {
            lease: self.live.lease(),
            turn,
            transition: window.prepare_post_sampling(policy, status, needs_follow_up),
        })
    }

    pub fn commit_post_sampling_token_budget(
        &mut self,
        turn: Uuid,
        prepared: PreparedTokenBudgetDecision,
    ) -> Result<TokenBudgetDecision, SessionError> {
        self.check_context_window_ready(turn)?;
        if prepared.turn != turn || prepared.lease != self.live.lease() {
            return Err(SessionError::InvalidBatch);
        }
        self.token_budget_window
            .as_mut()
            .ok_or(SessionError::InvalidBatch)?
            .commit_post_sampling(prepared.transition)
            .map_err(|_| SessionError::InvalidBatch)
    }
}
