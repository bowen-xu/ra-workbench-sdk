//! Codex rollout_reconstruction.rs user-boundary rollback contract.
//! Pinned e363b08c, Apache-2.0. Journal remains append-only; no tool undo.
use super::*;

impl ConversationProjection {
    pub(super) fn rollback(
        &mut self,
        last_turn: Uuid,
        user_turns: u32,
    ) -> Result<(), ProjectionError> {
        if self.active_turn.is_some()
            || self.has_unknown_tool_outcome()
            || self.turn_order.last() != Some(&last_turn)
            || user_turns == 0
        {
            return Err(ProjectionError::InvalidTransition);
        }
        let cut = self
            .turn_order
            .iter()
            .enumerate()
            .rev()
            .filter(|(_, id)| {
                self.turns.get(id).is_some_and(|turn| {
                    turn.items
                        .values()
                        .any(|item| matches!(item.kind, ItemKind::UserMessage))
                })
            })
            .nth(user_turns as usize - 1)
            .map(|(index, _)| index)
            .ok_or(ProjectionError::InvalidTransition)?;
        let removed = self.turn_order.split_off(cut);
        for id in removed {
            self.turns.remove(&id);
        }
        // Keep historical identity indices: removed IDs cannot be reused by a
        // later turn/item and mistaken for stale journal or checkpoint evidence.
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::TaskKind;

    fn emit(history: &mut ConversationProjection, payload: EventPayload) -> AgentEvent {
        let event = AgentEvent::new(
            history.conversation_id(),
            history.seq() + 1,
            1,
            Uuid::from_u128(1),
            payload,
        )
        .unwrap();
        history.apply(&event).unwrap();
        event
    }
    fn turn(
        history: &mut ConversationProjection,
        id: u128,
        users: usize,
        log: &mut Vec<AgentEvent>,
    ) {
        let turn_id = Uuid::from_u128(id);
        log.push(emit(
            history,
            EventPayload::TurnStarted {
                turn_id,
                context_snapshot_id: Uuid::from_u128(id + 100),
                model: ModelIdentity {
                    provider_id: "fixture".into(),
                    model_id: "model".into(),
                    revision: None,
                },
                task_kind: if users == 0 {
                    TaskKind::Compact
                } else {
                    TaskKind::Regular
                },
            },
        ));
        for n in 0..users {
            let item_id = Uuid::from_u128(id * 1000 + n as u128);
            log.push(emit(
                history,
                EventPayload::ItemStarted {
                    turn_id,
                    item_id,
                    kind: ItemKind::UserMessage,
                },
            ));
            log.push(emit(
                history,
                EventPayload::TextDelta {
                    turn_id,
                    item_id,
                    text: "user".into(),
                },
            ));
            log.push(emit(
                history,
                EventPayload::ItemCompleted { turn_id, item_id },
            ));
        }
        log.push(emit(
            history,
            EventPayload::TurnFinished {
                turn_id,
                outcome: TurnOutcome::Completed,
            },
        ));
    }

    #[test]
    fn rollback_replays_across_compact_turns_and_counts_multiple_steers_as_one_user_turn() {
        let id = ConversationId::from_uuid(Uuid::from_u128(1));
        let mut history = ConversationProjection::new(id);
        let mut log = vec![];
        turn(&mut history, 10, 1, &mut log);
        let watermark = history.seq();
        turn(&mut history, 20, 0, &mut log);
        turn(&mut history, 30, 2, &mut log);
        turn(&mut history, 40, 0, &mut log);
        let before = history.seq();
        let marker = emit(
            &mut history,
            EventPayload::ConversationRolledBack {
                turn_id: Uuid::from_u128(40),
                user_turns: 1,
            },
        );
        log.push(marker.clone());
        assert_eq!(history.seq(), before + 1);
        assert_eq!(
            history.turn_order(),
            [Uuid::from_u128(10), Uuid::from_u128(20)]
        );
        assert!(history.turn(Uuid::from_u128(30)).is_none());
        assert!(
            history
                .context_tail(watermark)
                .unwrap()
                .turn(Uuid::from_u128(30))
                .is_none()
        );
        assert_eq!(history.apply(&marker).unwrap(), ApplyResult::AlreadyApplied);
        let mut replay = ConversationProjection::new(id);
        for event in &log {
            let encoded = serde_json::to_string(event).unwrap();
            replay
                .apply(&serde_json::from_str(&encoded).unwrap())
                .unwrap();
        }
        assert_eq!(history, replay);
        let before = history.clone();
        let stale = AgentEvent::new(
            id,
            history.seq() + 1,
            1,
            Uuid::from_u128(1),
            EventPayload::TurnStarted {
                turn_id: Uuid::from_u128(30),
                context_snapshot_id: Uuid::from_u128(130),
                model: ModelIdentity {
                    provider_id: "fixture".into(),
                    model_id: "model".into(),
                    revision: None,
                },
                task_kind: TaskKind::Regular,
            },
        )
        .unwrap();
        assert!(history.apply(&stale).is_err());
        assert_eq!(history, before);
        log.push(emit(
            &mut history,
            EventPayload::ConversationRolledBack {
                turn_id: Uuid::from_u128(20),
                user_turns: 1,
            },
        ));
        assert!(history.turn_order().is_empty());
        turn(&mut history, 50, 1, &mut log);
        assert_eq!(history.turn_order(), [Uuid::from_u128(50)]);
        emit(
            &mut history,
            EventPayload::TurnStarted {
                turn_id: Uuid::from_u128(60),
                context_snapshot_id: Uuid::from_u128(160),
                model: ModelIdentity {
                    provider_id: "fixture".into(),
                    model_id: "model".into(),
                    revision: None,
                },
                task_kind: TaskKind::Regular,
            },
        );
        let before = history.clone();
        let reused_item = AgentEvent::new(
            id,
            history.seq() + 1,
            1,
            Uuid::from_u128(1),
            EventPayload::ItemStarted {
                turn_id: Uuid::from_u128(60),
                item_id: Uuid::from_u128(30_000),
                kind: ItemKind::UserMessage,
            },
        )
        .unwrap();
        assert!(history.apply(&reused_item).is_err());
        assert_eq!(history, before);
    }

    #[test]
    fn stale_active_and_excessive_rollbacks_leave_projection_unchanged() {
        let mut history =
            ConversationProjection::new(ConversationId::from_uuid(Uuid::from_u128(1)));
        let mut log = vec![];
        turn(&mut history, 10, 1, &mut log);
        for (last, count) in [(10, 0), (10, 2), (20, 1)] {
            let before = history.clone();
            assert!(history.rollback(Uuid::from_u128(last), count).is_err());
            assert_eq!(history, before);
        }
        emit(
            &mut history,
            EventPayload::TurnStarted {
                turn_id: Uuid::from_u128(20),
                context_snapshot_id: Uuid::from_u128(21),
                model: ModelIdentity {
                    provider_id: "fixture".into(),
                    model_id: "model".into(),
                    revision: None,
                },
                task_kind: TaskKind::Regular,
            },
        );
        let before = history.clone();
        assert!(history.rollback(Uuid::from_u128(20), 1).is_err());
        assert_eq!(history, before);
    }
}
