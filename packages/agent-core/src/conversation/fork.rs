//! Durable fork boundaries adapted from Codex's paginated_fork ThroughTurn semantics.
//! Source: e363b08c9175ac1cbe5893615dd2cb9ddf95043b, Apache-2.0.
use super::{
    CatalogError, CatalogFuture, CatalogMutationFuture, CatalogMutationStatus, ConversationBinding,
    ConversationId, ConversationSummary,
};
use crate::protocol::{AgentEvent, ConversationProjection, EventPayload};
use uuid::Uuid;

#[derive(Clone, Debug)]
pub struct ConversationForkRequest {
    /// Also the idempotency identity; a different request must use another ID.
    pub child_id: ConversationId,
    pub parent_id: ConversationId,
    pub through_turn_id: Uuid,
    /// An explicit existing parent association, never a permission grant.
    pub binding: ConversationBinding,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ConversationFork {
    pub conversation: ConversationSummary,
    pub parent_id: ConversationId,
    pub through_turn_id: Uuid,
    pub parent_end_seq: u64,
}

pub trait ConversationForkStore: Send + Sync {
    /// Atomically materialize a validated completed prefix and retain provenance.
    /// Retain compatible replacement history at the boundary with child-owned IDs.
    /// Never copy runtime admissions, queues, permissions, replay receipts or processes.
    /// Exact replay returns current child metadata, without resetting later history.
    fn fork(&self, request: ConversationForkRequest)
    -> CatalogMutationFuture<'_, ConversationFork>;
    /// Publish only in the caller's original data environment. The adapter must
    /// pin that same immutable owner through replay, preparation and commit;
    /// a status probe followed by a mutable/global gateway is not sufficient.
    /// Unsupported adapters must fail rather than silently dropping the fence.
    fn fork_in_epoch(
        &self,
        request: ConversationForkRequest,
        expected_epoch: Uuid,
    ) -> CatalogMutationFuture<'_, ConversationFork> {
        let _ = (request, expected_epoch);
        Box::pin(async { Err(CatalogError::Unavailable.into()) })
    }
    /// Inspect the original atomic publication, never create a branch or grant a writer.
    fn fork_status(
        &self,
        request: ConversationForkRequest,
    ) -> CatalogMutationFuture<'_, CatalogMutationStatus> {
        let _ = request;
        Box::pin(async { Err(CatalogError::Unavailable.into()) })
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ConversationForkOrigin {
    pub parent: ConversationSummary,
    pub through_turn_id: Uuid,
    pub parent_end_seq: u64,
}

pub trait ConversationForkReader: Send + Sync {
    /// Read the immediate parent in the original binding, without opening a writer.
    /// None means an existing root; absent/out-of-scope children return NotFound.
    /// Parent metadata is current; the turn boundary is immutable.
    fn read_origin(
        &self,
        child: ConversationId,
        binding: ConversationBinding,
    ) -> CatalogFuture<'_, Option<ConversationForkOrigin>>;
}

/// Copy only the completed historical prefix. Original turn/item/context/request
/// identities remain provenance; the adapter must retain the parent and must not
/// materialize any execution authorization from these historical events.
pub fn materialize_fork_history(
    request: &ConversationForkRequest,
    events: &[AgentEvent],
) -> Result<Vec<AgentEvent>, CatalogError> {
    if request.child_id.as_uuid().is_nil() || request.child_id == request.parent_id {
        return Err(CatalogError::InvalidInput);
    }
    let end = completed_fork_boundary(request.parent_id, request.through_turn_id, events)?;
    Ok(events[..end]
        .iter()
        .map(|event| event.inherited_by(request.child_id))
        .collect())
}

/// Returns an exclusive slice length / one-based terminal seq. A later active
/// turn is allowed, but an active target turn, gaps and duplicate events are not.
/// The caller must supply a consistent, bounded durable snapshot.
pub fn completed_fork_boundary(
    parent: ConversationId,
    through_turn: Uuid,
    events: &[AgentEvent],
) -> Result<usize, CatalogError> {
    if parent.as_uuid().is_nil() || through_turn.is_nil() {
        return Err(CatalogError::InvalidInput);
    }
    let mut projection = ConversationProjection::new(parent);
    let mut boundary = None;
    for (index, event) in events.iter().enumerate() {
        if event.seq() != index as u64 + 1 {
            return Err(CatalogError::Corrupt);
        }
        projection.apply(event).map_err(|_| CatalogError::Corrupt)?;
        if matches!(event.payload(), EventPayload::TurnFinished { turn_id, .. } if *turn_id == through_turn)
        {
            boundary = Some(index + 1);
        }
    }
    // A fork before the unknown operation must not grant a fresh execution path
    // that drops the source owner's unresolved side-effect barrier.
    if projection.has_unknown_tool_outcome() {
        return Err(CatalogError::Busy);
    }
    if let Some(boundary) = boundary {
        return Ok(boundary);
    }
    if projection.turn(through_turn).is_some() {
        Err(CatalogError::Busy)
    } else {
        Err(CatalogError::NotFound)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::{ModelIdentity, TurnOutcome};
    fn event(seq: u64, payload: EventPayload) -> AgentEvent {
        AgentEvent::new(
            ConversationId::from_uuid(Uuid::from_u128(1)),
            seq,
            0,
            Uuid::from_u128(9),
            payload,
        )
        .unwrap()
    }
    #[test]
    fn requires_an_exact_completed_prefix_without_inheriting_the_active_tail() {
        let parent = ConversationId::from_uuid(Uuid::from_u128(1));
        let turn = Uuid::from_u128(2);
        let start = event(
            1,
            EventPayload::TurnStarted {
                task_kind: crate::protocol::TaskKind::Regular,
                turn_id: turn,
                context_snapshot_id: Uuid::from_u128(3),
                model: ModelIdentity {
                    provider_id: "test".into(),
                    model_id: "test".into(),
                    revision: None,
                },
            },
        );
        let finish = event(
            2,
            EventPayload::TurnFinished {
                turn_id: turn,
                outcome: TurnOutcome::Canceled,
            },
        );
        assert_eq!(
            completed_fork_boundary(parent, turn, std::slice::from_ref(&start)),
            Err(CatalogError::Busy)
        );
        assert_eq!(
            completed_fork_boundary(parent, Uuid::from_u128(99), std::slice::from_ref(&start)),
            Err(CatalogError::NotFound)
        );
        assert_eq!(
            completed_fork_boundary(parent, turn, &[start.clone(), start.clone()]),
            Err(CatalogError::Corrupt)
        );
        assert_eq!(
            completed_fork_boundary(parent, turn, std::slice::from_ref(&finish)),
            Err(CatalogError::Corrupt)
        );
        assert_eq!(
            completed_fork_boundary(
                parent,
                turn,
                &[
                    start,
                    finish,
                    event(
                        3,
                        EventPayload::TurnStarted {
                            task_kind: crate::protocol::TaskKind::Regular,
                            turn_id: Uuid::from_u128(4),
                            context_snapshot_id: Uuid::from_u128(5),
                            model: ModelIdentity {
                                provider_id: "test".into(),
                                model_id: "test".into(),
                                revision: None
                            }
                        }
                    )
                ]
            ),
            Ok(2)
        );
    }
}
