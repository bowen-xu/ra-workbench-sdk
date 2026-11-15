//! Runtime once/request state migrated from Codex state/auto_compact_window.rs
//! and session/turn.rs, Apache-2.0, e363b08c9175ac1cbe5893615dd2cb9ddf95043b.
//! Copyright 2025 OpenAI. UUIDv7 generation stays in the host; this state has no
//! process, filesystem or random source. Prefill belongs to ContextAccounting.
use super::{TokenBudgetPolicy, TokenBudgetStatus};
use crate::model::ModelError;
use uuid::Uuid;

/// Not serialized: upstream reminder/fallback once flags are runtime-only.
/// Restore creates fresh flags; cross-process exactly-once is not promised.
#[derive(Clone, PartialEq, Eq)]
pub struct TokenBudgetWindow {
    number: u64,
    first_id: Uuid,
    previous_id: Option<Uuid>,
    id: Uuid,
    requested: bool,
    reminder_delivered: bool,
    fallback_delivered: bool,
}
#[derive(PartialEq, Eq)]
pub struct TokenBudgetDecision {
    /// Owner installs a reset candidate before any further model sampling.
    pub rollover: bool,
    /// Trusted context contributors, not assistant output or user chat messages.
    pub reminder: Option<String>,
    pub fallback: Option<String>,
}

/// Host persists the proposed fragments before committing this runtime change.
/// Dropping a proposal (including failed persistence) consumes no once claims
/// or pending new-window request. The private snapshot prevents stale commits.
pub struct TokenBudgetTransition {
    before: TokenBudgetWindow,
    after: TokenBudgetWindow,
    decision: TokenBudgetDecision,
}
impl TokenBudgetTransition {
    pub fn decision(&self) -> &TokenBudgetDecision {
        &self.decision
    }
}
impl TokenBudgetWindow {
    pub fn prepare_post_sampling(
        &self,
        policy: &TokenBudgetPolicy,
        status: TokenBudgetStatus,
        needs_follow_up: bool,
    ) -> TokenBudgetTransition {
        let mut after = self.clone();
        let decision = after.post_sampling(policy, status, needs_follow_up);
        TokenBudgetTransition {
            before: self.clone(),
            after,
            decision,
        }
    }

    /// Call only after the associated records are successfully committed.
    /// Any intervening claim, request change or window advance rejects the
    /// proposal without altering the current state.
    pub fn commit_post_sampling(
        &mut self,
        transition: TokenBudgetTransition,
    ) -> Result<TokenBudgetDecision, ModelError> {
        if *self != transition.before {
            return Err(ModelError::InvalidRequest);
        }
        *self = transition.after;
        Ok(transition.decision)
    }
    pub fn initial(id: Uuid) -> Result<Self, ModelError> {
        Self::restore(0, id, None, id)
    }
    pub fn restore(
        number: u64,
        first: Uuid,
        previous: Option<Uuid>,
        id: Uuid,
    ) -> Result<Self, ModelError> {
        if first.is_nil()
            || id.is_nil()
            || previous.is_some_and(|value| value.is_nil() || value == id)
            || (number == 0 && (first != id || previous.is_some()))
            || (number > 0 && (first == id || previous.is_none()))
        {
            return Err(ModelError::InvalidRequest);
        }
        Ok(Self {
            number,
            first_id: first,
            previous_id: previous,
            id,
            requested: false,
            reminder_delivered: false,
            fallback_delivered: false,
        })
    }
    pub fn number(&self) -> u64 {
        self.number
    }
    pub fn id(&self) -> Uuid {
        self.id
    }
    pub fn first_id(&self) -> Uuid {
        self.first_id
    }
    pub fn previous_id(&self) -> Option<Uuid> {
        self.previous_id
    }
    /// Called by an admitted new_context tool. It performs no rollover/I/O.
    pub fn request_new_context_window(&mut self) {
        self.requested = true;
    }
    pub fn take_new_context_window_request(&mut self) -> bool {
        std::mem::take(&mut self.requested)
    }
    pub fn clear_new_context_window_request(&mut self) {
        self.requested = false;
    }
    /// Called only after installation wins; failure does not advance window IDs
    /// or reset once flags. The boundary has already consumed its request flag.
    pub fn advance(&mut self, next: Uuid) -> Result<(), ModelError> {
        if next.is_nil()
            || next == self.id
            || next == self.first_id
            || Some(next) == self.previous_id
        {
            return Err(ModelError::InvalidRequest);
        }
        self.number = self.number.saturating_add(1);
        self.previous_id = Some(self.id);
        self.id = next;
        self.requested = false;
        self.reminder_delivered = false;
        self.fallback_delivered = false;
        Ok(())
    }
    /// Mirrors the post-response + complete-tool-batch boundary. A naturally
    /// ended turn does not consume the pending tool request or force rollover.
    pub fn post_sampling(
        &mut self,
        policy: &TokenBudgetPolicy,
        status: TokenBudgetStatus,
        needs_follow_up: bool,
    ) -> TokenBudgetDecision {
        let rollover =
            needs_follow_up && (std::mem::take(&mut self.requested) || status.token_limit_reached);
        let mut decision = TokenBudgetDecision {
            rollover,
            reminder: None,
            fallback: None,
        };
        let Some(remaining) = status.base_window_tokens_remaining else {
            return decision;
        };
        if !self.reminder_delivered
            && policy
                .settings()
                .reminder_threshold_tokens
                .is_some_and(|threshold| remaining <= threshold)
        {
            self.reminder_delivered = true;
            decision.reminder = Some(
                policy
                    .settings()
                    .reminder_message_template
                    .replace("{n_remaining}", &remaining.to_string()),
            );
        }
        if !rollover
            && !status.token_limit_reached
            && remaining == 0
            && !self.fallback_delivered
            && let Some(prompt) = policy.settings().auto_compact_fallback_prompt.as_ref()
        {
            self.fallback_delivered = true;
            decision.fallback = Some(prompt.clone());
        }
        decision
    }
}
