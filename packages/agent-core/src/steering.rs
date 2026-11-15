//! Process-scoped same-turn input. Host authorization precedes admission.
use crate::{skills::instructions::SkillInstructions, user_input::UserInput};
use std::{future::Future, pin::Pin};
use uuid::Uuid;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SteeringScope {
    pub conversation_id: Uuid,
    pub turn_id: Uuid,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SteeringInput {
    pub scope: SteeringScope,
    /// Also used as the UserMessage item ID when consumed.
    pub input_id: Uuid,
    pub text: String,
    pub user_input: Vec<UserInput>,
    /// Native admission freezes explicitly selected instructions before receipt.
    pub skill_instructions: Vec<SkillInstructions>,
}

impl SteeringInput {
    pub fn validate(&self) -> Result<(), SteeringError> {
        if self.scope.conversation_id.is_nil()
            || self.scope.turn_id.is_nil()
            || self.input_id.is_nil()
            || self.text.trim().is_empty()
            || self.text.len() > 65_536
        {
            return Err(SteeringError::Invalid);
        }
        crate::user_input::validate(&self.user_input, &self.text)
            .map_err(|_| SteeringError::Invalid)?;
        let mut bytes = 0usize;
        let mut seen = std::collections::HashSet::new();
        for prompt in &self.skill_instructions {
            bytes = bytes
                .checked_add(prompt.contents.len())
                .ok_or(SteeringError::Capacity)?;
            if bytes > 1_048_576 || prompt.contents.trim().is_empty() || prompt.contents.contains('\0')
                || !seen.insert(prompt.identity.clone())
                || !self.user_input.iter().any(|item| matches!(item, UserInput::Skill {name, identity} if name == &prompt.name && identity == &prompt.identity)) {
                return Err(SteeringError::Invalid);
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum SteeringError {
    #[error("invalid steering input")]
    Invalid,
    #[error("steering identity conflicts with saved input")]
    Conflict,
    #[error("active turn differs from expected turn")]
    ExpectedTurnMismatch { actual_turn_id: Uuid },
    #[error("active task does not accept steering")]
    NotSteerable {
        task_kind: crate::protocol::TaskKind,
    },
    #[error("turn no longer accepts input")]
    Closed,
    #[error("turn input capacity reached")]
    Capacity,
    #[error("steering storage unavailable")]
    Unavailable,
}
pub type SteeringFuture<'a, T> =
    Pin<Box<dyn Future<Output = Result<T, SteeringError>> + Send + 'a>>;

pub trait SteeringStore: Send + Sync {
    /// Idempotent admission for the current agent process; retrying the same ID
    /// cannot change its text.
    fn enqueue(&self, input: SteeringInput) -> SteeringFuture<'_, ()>;
    /// Returns unconsumed inputs in admission order, without deleting them. The
    /// host serializes consumption through the turn owner and commits UserMessage
    /// items using input_id. An empty finishing read atomically seals admission.
    fn pending(
        &self,
        scope: SteeringScope,
        finish_if_empty: bool,
    ) -> SteeringFuture<'_, Vec<SteeringInput>>;
    /// Close same-turn admission without consuming already accepted input.
    /// The host's terminal recovery policy continues to own those inputs.
    fn seal_for_stop(&self, scope: SteeringScope) -> SteeringFuture<'_, ()>;
}

/// Read-only recovery of admitted input that never became complete user history.
/// Terminal state must be durable. This neither reopens a turn nor resubmits input;
/// the host must obtain an explicit decision before using it in a new submission.
pub trait SteeringRecoveryStore: Send + Sync {
    fn recoverable(&self, scope: SteeringScope) -> SteeringFuture<'_, Vec<SteeringInput>>;
}
