use super::*;
use crate::protocol::{AssistantMessagePhase, NativeItemError};

impl ToolCall {
    pub fn arguments_json(&self) -> Result<String, ModelError> {
        match &self.raw_arguments_json {
            Some(raw) => {
                if serde_json::from_str::<serde_json::Value>(raw)
                    .map_err(|_| ModelError::InvalidStream)?
                    != self.arguments
                {
                    return Err(ModelError::InvalidStream);
                }
                Ok(raw.clone())
            }
            None => Ok(self.arguments.to_string()),
        }
    }
}

impl CompletedModelItem {
    /// Namespace used to live inside provider metadata. Moving it to common
    /// facts must preserve the same item and response metadata byte budget.
    pub(crate) fn metadata_bytes(&self) -> Result<usize, ModelError> {
        let native = self
            .native
            .as_ref()
            .map(|native| serde_json::to_vec(native).map(|bytes| bytes.len()))
            .transpose()
            .map_err(|_| ModelError::InvalidStream)?
            .unwrap_or(0);
        let namespace = match &self.normalized {
            Some(ModelOutputItem::ToolCall(call)) => call
                .namespace
                .as_ref()
                .map(|value| serde_json::to_vec(value).map(|bytes| bytes.len()))
                .transpose()
                .map_err(|_| ModelError::InvalidStream)?
                .unwrap_or(0),
            Some(ModelOutputItem::ReasoningSummary(summary)) => serde_json::to_vec(&summary.parts)
                .map_err(|_| ModelError::InvalidStream)?
                .len(),
            _ => 0,
        };
        native
            .checked_add(namespace)
            .ok_or(ModelError::BudgetExceeded)
    }

    pub fn validate(&self) -> Result<(), ModelError> {
        if self.normalized.is_none() && self.native.is_none() {
            return Err(ModelError::InvalidStream);
        }
        if self.canonical_item_id.is_some_and(|id| id.is_nil()) {
            return Err(ModelError::InvalidStream);
        }
        if let Some(native) = &self.native {
            native.validate().map_err(|error| match error {
                NativeItemError::ByteLimit => ModelError::BudgetExceeded,
                _ => ModelError::InvalidStream,
            })?;
        }
        if self.metadata_bytes()? > crate::protocol::MAX_NATIVE_ITEM_BYTES {
            return Err(ModelError::BudgetExceeded);
        }
        match &self.normalized {
            Some(ModelOutputItem::Message(message))
                if message.item_id.is_empty()
                    || message.item_id.len() > 1024
                    || message.phase == Some(AssistantMessagePhase::Reasoning)
                    || self
                        .native
                        .as_ref()
                        .and_then(|value| value.item_id.as_ref())
                        .is_some_and(|id| id != &message.item_id) =>
            {
                return Err(ModelError::InvalidStream);
            }
            Some(ModelOutputItem::ToolCall(call)) => {
                super::tool_intent::validate_identity(&call.call_id, &call.name)?;
            }
            Some(ModelOutputItem::ReasoningSummary(summary)) => {
                if summary.item_id.is_empty()
                    || summary.item_id.len() > 1024
                    || !crate::protocol::validate_summary_parts(&summary.text, &summary.parts)
                    || self
                        .native
                        .as_ref()
                        .and_then(|value| value.item_id.as_ref())
                        .is_some_and(|id| id != &summary.item_id)
                {
                    return Err(ModelError::InvalidStream);
                }
            }
            Some(ModelOutputItem::Message(_)) | None => {}
        }
        if self.normalized.is_none()
            && self
                .native
                .as_ref()
                .is_some_and(|data| matches!(data.item_type.as_str(), "message" | "function_call"))
        {
            return Err(ModelError::InvalidStream);
        }
        Ok(())
    }
}

impl ModelMessage {
    /// Normalized calls remain the only executable/pairing surface. Native-only
    /// provider data never manufactures a tool intent.
    pub fn has_tool_calls(&self) -> bool {
        match self {
            Self::Assistant { tool_calls, .. } => !tool_calls.is_empty(),
            Self::CanonicalOutput(item) => {
                matches!(&item.normalized, Some(ModelOutputItem::ToolCall(_)))
            }
            _ => false,
        }
    }

    pub fn tool_call_identities(&self) -> impl Iterator<Item = (&str, &str)> {
        let (legacy, canonical): (&[ToolCall], Option<&ToolCallIntent>) = match self {
            Self::Assistant { tool_calls, .. } => (tool_calls, None),
            Self::CanonicalOutput(item) => match &item.normalized {
                Some(ModelOutputItem::ToolCall(call)) => (&[], Some(call)),
                _ => (&[], None),
            },
            _ => (&[], None),
        };
        legacy
            .iter()
            .map(|call| (call.call_id.as_str(), call.name.as_str()))
            .chain(canonical.map(|call| (call.call_id.as_str(), call.name.as_str())))
    }
}

impl CapturedHistoryRef {
    pub fn validate(&self) -> Result<(), ModelError> {
        use std::collections::HashSet;
        let mut turns = HashSet::new();
        let mut users = HashSet::new();
        if self.conversation_id.is_nil()
            || self.after_seq > self.through_seq
            || self.through_seq > 9_007_199_254_740_991
            || self.turns.iter().any(|turn| {
                turn.turn_id.is_nil()
                    || !turns.insert(turn.turn_id)
                    || turn
                        .user_item_ids
                        .iter()
                        .any(|id| id.is_nil() || !users.insert(*id))
            })
        {
            return Err(ModelError::InvalidRequest);
        }
        Ok(())
    }
}
