use super::*;

impl ConversationProjection {
    /// A terminal diagnostic cannot reconcile an external effect. This barrier
    /// is derived from durable facts, so reopening or trimming model history
    /// cannot turn an unknown operation into permission to execute again.
    pub fn has_unknown_tool_outcome(&self) -> bool {
        self.turn_order.iter().any(|id| self.turns.get(id).is_some_and(|turn| {
            if !turn.pending_tool_receipts.is_empty() {
                return true;
            }
            let recovery_diagnostic = turn.failure.as_ref()
                .is_some_and(|(_, category)| *category == FailureCategory::Recovery);
            turn.items.values().any(|call| call.completed
                && (recovery_diagnostic || (turn.outcome.is_some() && call.accepted)) && matches!(call.kind,
                    ItemKind::ToolCall { call_id, .. } if !turn.items.values().any(|result|
                        result.completed && matches!(result.kind,
                            ItemKind::ToolResult { call_id: result_id, .. } if result_id == call_id))))
        }))
    }
}
