use super::*;

impl ConversationProjection {
    /// Model-only view after a committed replacement. Original history stays
    /// unchanged. The boundary must not split a streaming item or tool pair.
    pub fn context_tail(&self, watermark: u64) -> Result<Self, ProjectionError> {
        if watermark > self.seq || self.active_turn.is_some() || self.has_unknown_tool_outcome() {
            return Err(ProjectionError::InvalidTransition);
        }
        let mut tail = self.clone();
        for turn in tail.turns.values_mut() {
            for item_id in &turn.item_order {
                let (start, last) = self
                    .item_sequences
                    .get(item_id)
                    .ok_or(ProjectionError::InvalidTransition)?;
                if *start <= watermark && *last > watermark {
                    return Err(ProjectionError::InvalidTransition);
                }
            }
            turn.items.retain(|id, _| {
                self.item_sequences
                    .get(id)
                    .is_some_and(|(_, last)| *last > watermark)
            });
            turn.item_order.retain(|id| turn.items.contains_key(id));
            for item in turn.items.values() {
                if let ItemKind::ToolResult { call_id, .. } = item.kind
                    && !turn.items.values().any(|call| matches!(call.kind, ItemKind::ToolCall { call_id: id, .. } if id == call_id)) {
                    return Err(ProjectionError::InvalidTransition);
                }
            }
        }
        Ok(tail)
    }

    pub fn turn_started_after(&self, turn_id: Uuid, watermark: u64) -> bool {
        self.turn_start_sequences
            .get(&turn_id)
            .is_some_and(|seq| *seq > watermark)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn next_id() -> Uuid {
        static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(100);
        Uuid::from_u128(NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed) as u128)
    }
    fn emit(history: &mut ConversationProjection, payload: EventPayload) {
        let event = AgentEvent::new(
            history.conversation_id(),
            history.seq() + 1,
            1,
            Uuid::from_u128(20),
            payload,
        )
        .unwrap();
        history.apply(&event).unwrap();
    }
    fn start(history: &mut ConversationProjection, turn: Uuid) {
        emit(
            history,
            EventPayload::TurnStarted {
                task_kind: crate::protocol::TaskKind::Regular,
                turn_id: turn,
                context_snapshot_id: next_id(),
                model: ModelIdentity {
                    provider_id: "fixture".into(),
                    model_id: "model".into(),
                    revision: None,
                },
            },
        );
    }
    fn item(
        history: &mut ConversationProjection,
        turn: Uuid,
        id: Uuid,
        kind: ItemKind,
        text: &str,
    ) {
        emit(
            history,
            EventPayload::ItemStarted {
                turn_id: turn,
                item_id: id,
                kind,
            },
        );
        emit(
            history,
            EventPayload::TextDelta {
                turn_id: turn,
                item_id: id,
                text: text.into(),
            },
        );
        emit(
            history,
            EventPayload::ItemCompleted {
                turn_id: turn,
                item_id: id,
            },
        );
    }
    #[test]
    fn checkpoint_tail_omits_covered_context_and_input_but_keeps_later_reply() {
        let mut history = ConversationProjection::new(ConversationId::from_uuid(next_id()));
        let turn = next_id();
        start(&mut history, turn);
        item(
            &mut history,
            turn,
            next_id(),
            ItemKind::UserMessage,
            "old user",
        );
        let cutoff = history.seq();
        item(
            &mut history,
            turn,
            next_id(),
            ItemKind::AssistantMessage,
            "later reply",
        );
        emit(
            &mut history,
            EventPayload::TurnFinished {
                turn_id: turn,
                outcome: TurnOutcome::Completed,
            },
        );
        let original = history.clone();
        let contexts = std::collections::HashMap::from([(
            turn,
            vec![crate::model::ContentPart::Text("covered context".into())],
        )]);
        let messages = crate::model::reconstruct_history_after_checkpoint(
            &history,
            &contexts,
            &Default::default(),
            cutoff,
        )
        .unwrap();
        assert_eq!(messages.len(), 1);
        assert!(
            matches!(&messages[0], crate::model::ModelMessage::CanonicalOutput(item) if
                item.canonical_item_id.is_some() && matches!(&item.normalized,
                    Some(crate::model::ModelOutputItem::Message(message)) if message.text=="later reply"))
        );
        assert_eq!(history, original);
    }
    #[test]
    fn rejects_a_cutoff_inside_a_streaming_item_or_tool_pair() {
        let mut history = ConversationProjection::new(ConversationId::from_uuid(next_id()));
        let turn = next_id();
        start(&mut history, turn);
        let call = next_id();
        item(
            &mut history,
            turn,
            next_id(),
            ItemKind::ToolCall {
                call_id: call,
                name: "read".into(),
                provider_call_id: None,
                namespace: None,
            },
            "{}",
        );
        let cutoff = history.seq();
        item(
            &mut history,
            turn,
            next_id(),
            ItemKind::ToolResult {
                call_id: call,
                is_error: Some(false),
            },
            "evidence",
        );
        emit(
            &mut history,
            EventPayload::TurnFinished {
                turn_id: turn,
                outcome: TurnOutcome::Completed,
            },
        );
        assert!(history.context_tail(cutoff).is_err());
        assert!(history.context_tail(2).is_err());
        assert!(history.context_tail(0).is_ok());
    }

    #[test]
    fn output_order_is_part_of_each_items_checkpoint_boundary() {
        let mut history = ConversationProjection::new(ConversationId::from_uuid(next_id()));
        let turn = next_id();
        start(&mut history, turn);
        item(
            &mut history,
            turn,
            next_id(),
            ItemKind::UserMessage,
            "input",
        );
        let before_output = history.seq();
        let first = next_id();
        let second = next_id();
        let tool_item = next_id();
        let call = next_id();
        item(
            &mut history,
            turn,
            first,
            ItemKind::AssistantMessage,
            "before tool",
        );
        item(
            &mut history,
            turn,
            second,
            ItemKind::AssistantMessage,
            "after tool",
        );
        item(
            &mut history,
            turn,
            tool_item,
            ItemKind::ToolCall {
                call_id: call,
                name: "read".into(),
                provider_call_id: Some("provider-call".into()),
                namespace: None,
            },
            "{}",
        );
        let completed_before_order = history.seq();
        emit(
            &mut history,
            EventPayload::ModelOutputOrder {
                turn_id: turn,
                item_ids: vec![first, tool_item, second],
            },
        );
        let ordered_before_result = history.seq();
        let result = next_id();
        item(
            &mut history,
            turn,
            result,
            ItemKind::ToolResult {
                call_id: call,
                is_error: Some(false),
            },
            "result",
        );
        let paired = history.seq();
        let later = next_id();
        item(
            &mut history,
            turn,
            later,
            ItemKind::AssistantMessage,
            "later response",
        );
        emit(
            &mut history,
            EventPayload::TurnFinished {
                turn_id: turn,
                outcome: TurnOutcome::Completed,
            },
        );

        assert!(
            history.context_tail(completed_before_order).is_err(),
            "completed items still depend on the later ordering fact"
        );
        assert!(
            history.context_tail(ordered_before_result).is_err(),
            "a result cannot outlive its removed call"
        );
        let tail = history.context_tail(paired).unwrap();
        assert_eq!(tail.turn(turn).unwrap().item_order, vec![later]);
        assert_eq!(
            history
                .context_tail(before_output)
                .unwrap()
                .turn(turn)
                .unwrap()
                .item_order,
            vec![first, tool_item, second, result, later]
        );
    }
}
