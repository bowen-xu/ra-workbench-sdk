//! Bounded child-task policy adapted from Codex fork/child-turn lifecycle.
//! Scheduling and persistence stay in the host; this module only validates the
//! immutable relationship and prevents privilege or budget expansion.

use std::{collections::HashSet, future::Future, pin::Pin};
use uuid::Uuid;

pub const MAX_DEPTH: u8 = 2;
pub const MAX_PROMPT_BYTES: usize = 16 * 1024;

/// Request shape owned by an Agent tool. The host chooses the child identity
/// and turns this request into a bounded `SubtaskSpec`; model/tool permissions
/// can only be narrowed by the host.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SpawnRequest {
    pub prompt: String,
    pub context_snapshot_id: Uuid,
    pub model_calls: usize,
    pub tool_calls: usize,
    pub approved_servers: HashSet<String>,
}

impl SpawnRequest {
    pub fn validate(&self) -> Result<(), SubtaskError> {
        let bytes = self.prompt.len();
        if self.prompt.trim().is_empty()
            || bytes > MAX_PROMPT_BYTES
            || self.context_snapshot_id.is_nil()
            || self.model_calls == 0
            || self.tool_calls == 0
            || self.approved_servers.iter().any(|server| {
                server.is_empty() || server.len() > 128 || server.chars().any(char::is_control)
            })
        {
            return Err(SubtaskError::InvalidRequest);
        }
        Ok(())
    }
}

/// Constructor-injected host helper, adapted from Codex's `AgentSpawner`.
/// Core owns the request boundary; native owns conversation creation, model
/// selection, execution and durable child-task reconciliation.
pub type SubtaskFuture<'a, T, E> = Pin<Box<dyn Future<Output = Result<T, E>> + Send + 'a>>;

pub trait SubtaskSpawner<R>: Send + Sync {
    type Spawned;
    type Error;

    fn spawn_subtask<'a>(
        &'a self,
        parent: Uuid,
        request: R,
    ) -> SubtaskFuture<'a, Self::Spawned, Self::Error>;
}

impl<R, S, E, F> SubtaskSpawner<R> for F
where
    F: Fn(Uuid, R) -> SubtaskFuture<'static, S, E> + Send + Sync,
{
    type Spawned = S;
    type Error = E;

    fn spawn_subtask<'a>(
        &'a self,
        parent: Uuid,
        request: R,
    ) -> SubtaskFuture<'a, Self::Spawned, Self::Error> {
        self(parent, request)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SubtaskSpec {
    pub parent_conversation_id: Uuid,
    pub child_conversation_id: Uuid,
    pub parent_context_snapshot_id: Uuid,
    pub child_context_snapshot_id: Uuid,
    pub depth: u8,
    pub model_calls: usize,
    pub tool_calls: usize,
    pub approved_servers: HashSet<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub enum SubtaskError {
    #[error("invalid subtask identity")]
    InvalidIdentity,
    #[error("subtask depth exceeds the policy")]
    DepthExceeded,
    #[error("subtask budget exceeds its parent")]
    BudgetExpanded,
    #[error("subtask permissions exceed its parent")]
    PermissionExpanded,
    #[error("invalid subtask request")]
    InvalidRequest,
}

/// A child may narrow a frozen scope and budget, never broaden it. The child
/// gets its own conversation identity so its events/history remain separate.
pub fn validate_child(parent: &SubtaskSpec, child: &SubtaskSpec) -> Result<(), SubtaskError> {
    if parent.child_conversation_id != child.parent_conversation_id
        || parent.child_context_snapshot_id != child.parent_context_snapshot_id
        || child.child_conversation_id.is_nil()
        || child.child_context_snapshot_id.is_nil()
        || child.child_conversation_id == child.parent_conversation_id
        || child.depth != parent.depth.saturating_add(1)
    {
        return Err(SubtaskError::InvalidIdentity);
    }
    if child.depth > MAX_DEPTH {
        return Err(SubtaskError::DepthExceeded);
    }
    if child.model_calls > parent.model_calls || child.tool_calls > parent.tool_calls {
        return Err(SubtaskError::BudgetExpanded);
    }
    if !child.approved_servers.is_subset(&parent.approved_servers) {
        return Err(SubtaskError::PermissionExpanded);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec(depth: u8) -> SubtaskSpec {
        let parent = Uuid::from_u128(1);
        let context = Uuid::from_u128(2);
        SubtaskSpec {
            parent_conversation_id: parent,
            child_conversation_id: Uuid::from_u128(3),
            parent_context_snapshot_id: context,
            child_context_snapshot_id: context,
            depth,
            model_calls: 4,
            tool_calls: 8,
            approved_servers: ["literature".into()].into_iter().collect(),
        }
    }

    #[test]
    fn child_can_narrow_but_not_expand_scope() {
        let parent = spec(0);
        let mut child = SubtaskSpec {
            parent_conversation_id: parent.child_conversation_id,
            child_conversation_id: Uuid::from_u128(4),
            parent_context_snapshot_id: parent.child_context_snapshot_id,
            child_context_snapshot_id: parent.child_context_snapshot_id,
            depth: 1,
            model_calls: 2,
            tool_calls: 3,
            approved_servers: HashSet::new(),
        };
        validate_child(&parent, &child).unwrap();
        child.approved_servers.insert("shell".into());
        assert_eq!(
            validate_child(&parent, &child),
            Err(SubtaskError::PermissionExpanded)
        );
        child.approved_servers.clear();
        child.tool_calls = 9;
        assert_eq!(
            validate_child(&parent, &child),
            Err(SubtaskError::BudgetExpanded)
        );
    }

    #[test]
    fn depth_and_identity_are_bounded() {
        let parent = spec(MAX_DEPTH);
        let mut child = spec(MAX_DEPTH + 1);
        child.parent_conversation_id = parent.child_conversation_id;
        child.child_conversation_id = Uuid::from_u128(5);
        child.parent_context_snapshot_id = parent.child_context_snapshot_id;
        child.child_context_snapshot_id = parent.child_context_snapshot_id;
        child.depth = MAX_DEPTH + 1;
        assert_eq!(
            validate_child(&parent, &child),
            Err(SubtaskError::DepthExceeded)
        );
    }

    #[test]
    fn spawn_request_is_bounded_before_host_execution() {
        let valid = SpawnRequest {
            prompt: "delegate this paragraph".into(),
            context_snapshot_id: Uuid::from_u128(9),
            model_calls: 2,
            tool_calls: 3,
            approved_servers: ["literature".into()].into_iter().collect(),
        };
        valid.validate().unwrap();
        let mut invalid = valid.clone();
        invalid.prompt = " ".into();
        assert_eq!(invalid.validate(), Err(SubtaskError::InvalidRequest));
        invalid.prompt = "x".repeat(MAX_PROMPT_BYTES + 1);
        assert_eq!(invalid.validate(), Err(SubtaskError::InvalidRequest));
    }
}
