//! Codex compact.rs / context_manager/history.rs, e363b08c, Apache-2.0.
//! Copyright 2025 OpenAI. Request-copy shrinking preserves current instructions.
use crate::model::{ModelMessage, ModelOutputItem, ModelRequest};
use std::collections::HashSet;

/// Remove the oldest history item and its tool counterpart. The last user
/// item is the synthetic handoff prompt; system instructions are independent.
pub(super) fn remove_oldest(request: &mut ModelRequest) -> bool {
    let Some(index) = request
        .messages
        .iter()
        .take(request.messages.len().saturating_sub(1))
        .position(|item| !matches!(item, ModelMessage::System(_) | ModelMessage::Developer(_)))
    else {
        return false;
    };
    let removed = request.messages.remove(index);
    let calls: HashSet<_> = removed
        .tool_call_identities()
        .map(|(call_id, _)| call_id.to_owned())
        .collect();
    match removed {
        _ if !calls.is_empty() => {
            request.messages.retain(|item| !matches!(item, ModelMessage::ToolResult { call_id, .. } if calls.contains(call_id)));
        }
        ModelMessage::ToolResult { call_id, .. } => {
            request.messages.retain_mut(|item| {
                if let ModelMessage::Assistant { tool_calls, .. } = item {
                    tool_calls.retain(|call| call.call_id != call_id);
                }
                !matches!(item,ModelMessage::CanonicalOutput(complete) if matches!(&complete.normalized,Some(ModelOutputItem::ToolCall(call)) if call.call_id==call_id))
            });
        }
        _ => {}
    }
    true
}
