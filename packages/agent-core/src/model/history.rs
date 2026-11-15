//! Prompt-only history reconstruction. Adapted from Codex context_manager/normalize.rs
//! (Apache-2.0, Copyright 2025 OpenAI). Unlike upstream's `aborted` placeholder,
//! missing durable results explicitly leave external execution outcomes unknown.
use super::{
    AssistantMessage, CompletedModelItem, ContentPart, ModelMessage, ModelOutputItem,
    ToolCallIntent,
};
use crate::protocol::{ConversationProjection, ItemKind};
use std::collections::{HashMap, HashSet};
use uuid::Uuid;

/// Stable prompt identity shared by history reconstruction and native replay adapters.
pub fn history_tool_call_id(item_id: Uuid) -> String {
    format!("call_{}", item_id.simple())
}

#[derive(Debug, PartialEq, Eq, thiserror::Error)]
pub enum HistoryError {
    #[error("active history must be reconciled before preparing another turn")]
    ActiveTurn,
    #[error("tool_outcome_unknown: history requires external outcome reconciliation")]
    ToolOutcomeUnknown,
    #[error("history contains incomplete input or tool arguments")]
    IncompleteInput,
    #[error("history cannot be represented in model message order")]
    InvalidOrder,
    #[error(transparent)]
    NativeItem(#[from] crate::protocol::NativeItemError),
}

/// Reconstruct the current text journal without changing it or executing tools.
/// Missing tool results receive explicitly synthetic, prompt-only error messages.
/// Provider IDs are scoped to a request and can repeat in later turns: replay IDs
/// derive from globally unique item IDs, leaving original provenance untouched.
/// Context snapshots and future multimodal inputs must be resolved separately;
/// this function is not a complete turn/context builder.
pub fn reconstruct_history(
    history: &ConversationProjection,
) -> Result<Vec<ModelMessage>, HistoryError> {
    reconstruct_history_with_context(history, &HashMap::new())
}

/// Context must already be resolved against each turn's frozen snapshot. It is
/// inserted as user-supplied source content, never promoted to system instructions.
pub fn reconstruct_history_with_context(
    history: &ConversationProjection,
    contexts: &HashMap<Uuid, Vec<ContentPart>>,
) -> Result<Vec<ModelMessage>, HistoryError> {
    reconstruct_history_internal(
        history,
        contexts,
        &HashMap::new(),
        &HashMap::new(),
        &HashMap::new(),
        false,
    )
}

/// Reconstruct history for a new user turn after a previous turn was durably
/// interrupted. Incomplete tool calls are deliberately projected as quoted
/// context and omitted from the provider request; they are never replayed.
/// Strict reconstruction remains the default for callers that need to prove
/// every historical item is provider-representable.
pub fn reconstruct_history_for_continuation(
    history: &ConversationProjection,
    contexts: &HashMap<Uuid, Vec<ContentPart>>,
) -> Result<Vec<ModelMessage>, HistoryError> {
    reconstruct_history_internal(
        history,
        contexts,
        &HashMap::new(),
        &HashMap::new(),
        &HashMap::new(),
        true,
    )
}

/// Per-item context preserves the position of same-turn skill injections.
pub fn reconstruct_history_for_continuation_with_user_context(
    history: &ConversationProjection,
    contexts: &HashMap<Uuid, Vec<ContentPart>>,
    user_contexts: &HashMap<Uuid, Vec<ContentPart>>,
) -> Result<Vec<ModelMessage>, HistoryError> {
    reconstruct_history_internal(
        history,
        contexts,
        user_contexts,
        &HashMap::new(),
        &HashMap::new(),
        true,
    )
}

/// Developer bodies must come from a trusted policy ledger, never chat text or
/// user context. Anchors preserve contributor order without changing the journal.
/// The host filters records by active window and covered journal watermark.
pub fn reconstruct_history_with_developer_fragments(
    history: &ConversationProjection,
    contexts: &HashMap<Uuid, Vec<ContentPart>>,
    user_contexts: &HashMap<Uuid, Vec<ContentPart>>,
    fragments: &HashMap<Uuid, Vec<String>>,
    watermark: Option<u64>,
) -> Result<Vec<ModelMessage>, HistoryError> {
    reconstruct_history_with_developer_context(
        history,
        contexts,
        user_contexts,
        fragments,
        &HashMap::new(),
        watermark,
    )
}

/// Trusted hook context precedes the surviving input in its source turn, even
/// when that turn was canceled before producing any assistant or tool items.
/// The host must select prefixes from the active window and exclude checkpoint-
/// covered or revoked records. User content must never enter this argument.
pub fn reconstruct_history_with_developer_context(
    history: &ConversationProjection,
    contexts: &HashMap<Uuid, Vec<ContentPart>>,
    user_contexts: &HashMap<Uuid, Vec<ContentPart>>,
    fragments: &HashMap<Uuid, Vec<String>>,
    prefixes: &HashMap<Uuid, Vec<String>>,
    watermark: Option<u64>,
) -> Result<Vec<ModelMessage>, HistoryError> {
    if history.has_unknown_tool_outcome() {
        return Err(HistoryError::ToolOutcomeUnknown);
    }
    if let Some(watermark) = watermark {
        let tail = history
            .context_tail(watermark)
            .map_err(|_| HistoryError::InvalidOrder)?;
        let contexts = contexts
            .iter()
            .filter(|(turn, _)| history.turn_started_after(**turn, watermark))
            .map(|(id, parts)| (*id, parts.clone()))
            .collect();
        reconstruct_history_internal(&tail, &contexts, user_contexts, fragments, prefixes, true)
    } else {
        reconstruct_history_internal(history, contexts, user_contexts, fragments, prefixes, true)
    }
}

/// Preserve only journal items and frozen turn contexts after an installed
/// replacement boundary. Replay normalization and tool identity stay shared.
pub fn reconstruct_history_after_checkpoint(
    history: &ConversationProjection,
    contexts: &HashMap<Uuid, Vec<ContentPart>>,
    user_contexts: &HashMap<Uuid, Vec<ContentPart>>,
    watermark: u64,
) -> Result<Vec<ModelMessage>, HistoryError> {
    if history.has_unknown_tool_outcome() {
        return Err(HistoryError::ToolOutcomeUnknown);
    }
    let tail = history
        .context_tail(watermark)
        .map_err(|_| HistoryError::InvalidOrder)?;
    let contexts = contexts
        .iter()
        .filter(|(turn, _)| history.turn_started_after(**turn, watermark))
        .map(|(id, parts)| (*id, parts.clone()))
        .collect();
    reconstruct_history_internal(
        &tail,
        &contexts,
        user_contexts,
        &HashMap::new(),
        &HashMap::new(),
        true,
    )
}

fn reconstruct_history_internal(
    history: &ConversationProjection,
    contexts: &HashMap<Uuid, Vec<ContentPart>>,
    user_contexts: &HashMap<Uuid, Vec<ContentPart>>,
    fragments: &HashMap<Uuid, Vec<String>>,
    prefixes: &HashMap<Uuid, Vec<String>>,
    allow_interrupted_tool_calls: bool,
) -> Result<Vec<ModelMessage>, HistoryError> {
    if history.has_unknown_tool_outcome() {
        return Err(HistoryError::ToolOutcomeUnknown);
    }
    if history.active_turn().is_some() {
        return Err(HistoryError::ActiveTurn);
    }
    if prefixes.iter().any(|(id, bodies)| {
        bodies.is_empty()
            || history
                .turn(*id)
                .is_none_or(|turn| !turn.task_kind.is_regular())
    }) {
        return Err(HistoryError::InvalidOrder);
    }
    if contexts.keys().any(|id| history.turn(*id).is_none()) {
        return Err(HistoryError::InvalidOrder);
    }
    if fragments.iter().any(|(anchor, bodies)| {
        bodies.is_empty()
            || bodies.iter().any(|body| body.trim().is_empty())
            || !history.turn_order().iter().any(|id| {
                history.turn(*id).is_some_and(|turn| {
                    turn.task_kind.is_regular()
                        && turn.items.get(anchor).is_some_and(|item| {
                            item.completed
                                && matches!(
                                    item.kind,
                                    ItemKind::AssistantMessage | ItemKind::ToolResult { .. }
                                )
                        })
                })
            })
    }) {
        return Err(HistoryError::InvalidOrder);
    }
    let mut messages = Vec::new();
    for turn_id in history.turn_order() {
        let turn = history.turn(*turn_id).ok_or(HistoryError::InvalidOrder)?;
        if !turn.task_kind.is_regular() {
            continue;
        }
        if let Some(bodies) = prefixes.get(turn_id) {
            messages.extend(bodies.iter().cloned().map(ModelMessage::Developer));
        }
        if let Some(content) = contexts.get(turn_id)
            && !content.is_empty()
        {
            messages.push(ModelMessage::User {
                content: content.clone(),
                source_item_id: None,
            });
        }
        let interrupted_turn = allow_interrupted_tool_calls
            && turn
                .outcome()
                .is_some_and(|outcome| outcome != crate::protocol::TurnOutcome::Completed)
            && turn.items.values().any(|item| {
                item.interrupted
                    && matches!(
                        item.kind,
                        ItemKind::ToolCall { .. } | ItemKind::ToolResult { .. }
                    )
            });
        if interrupted_turn {
            messages.push(ModelMessage::Assistant {
                phase: None,
                content: vec![ContentPart::Text(
                    "[History notice: the interrupted turn was omitted and will not be replayed.]"
                        .into(),
                )],
                tool_calls: vec![],
            });
            // Tool replay omission does not erase already committed policy
            // contributors. Preserve their order after the omission notice.
            for item in &turn.item_order {
                if let Some(bodies) = fragments.get(item) {
                    messages.extend(bodies.iter().cloned().map(ModelMessage::Developer));
                }
            }
            continue;
        }
        let results: HashSet<Uuid> = turn
            .items
            .values()
            .filter_map(|item| match item.kind {
                ItemKind::ToolResult { call_id, .. } => Some(call_id),
                _ => None,
            })
            .collect();
        let mut pending = Vec::<(Uuid, String)>::new();
        let mut replay_ids = HashMap::new();
        for item_id in &turn.item_order {
            let item = turn.items.get(item_id).ok_or(HistoryError::InvalidOrder)?;
            match &item.kind {
                // Lifecycle survives in the journal, but is not model context.
                ItemKind::ContextCompaction => {}
                ItemKind::HookPrompt { fragments, .. } => {
                    if !item.completed {
                        return Err(HistoryError::IncompleteInput);
                    }
                    finish_missing(&mut messages, &mut pending, &results)?;
                    messages.push(ModelMessage::User {
                        content: fragments
                            .iter()
                            .map(|part| ContentPart::Text(part.input_text.clone()))
                            .collect(),
                        source_item_id: Some(*item_id),
                    });
                }
                ItemKind::UserMessage | ItemKind::AssistantMessage => {
                    // Codex prompt history records completed output items, not
                    // a draft from a failed stream. Never synthesize "continue".
                    if matches!(item.kind, ItemKind::AssistantMessage) && !item.completed {
                        continue;
                    }
                    if matches!(item.kind, ItemKind::UserMessage) {
                        finish_missing(&mut messages, &mut pending, &results)?;
                    }
                    let text = item.text.clone();
                    if !item.completed {
                        return Err(HistoryError::IncompleteInput);
                    }
                    let mut content = if text.is_empty() {
                        vec![]
                    } else {
                        vec![ContentPart::Text(text)]
                    };
                    if matches!(item.kind, ItemKind::UserMessage)
                        && let Some(parts) = user_contexts.get(item_id)
                    {
                        content.splice(0..0, parts.clone());
                    }
                    if matches!(item.kind, ItemKind::UserMessage) && content.is_empty() {
                        return Err(HistoryError::IncompleteInput);
                    }
                    messages.push(if matches!(item.kind, ItemKind::UserMessage) {
                        ModelMessage::User {
                            content,
                            source_item_id: Some(*item_id),
                        }
                    } else {
                        canonical(
                            *item_id,
                            item,
                            Some(ModelOutputItem::Message(AssistantMessage {
                                item_id: item
                                    .source
                                    .as_ref()
                                    .and_then(|source| source.provider_item_id.clone())
                                    .unwrap_or_else(|| item_id.to_string()),
                                text: item.text.clone(),
                                phase: item.native_phase,
                            })),
                        )?
                    });
                }
                ItemKind::ReasoningSummary { parts } => {
                    if !item.completed {
                        continue;
                    }
                    messages.push(canonical(
                        *item_id,
                        item,
                        Some(ModelOutputItem::ReasoningSummary(super::ReasoningSummary {
                            item_id: item
                                .source
                                .as_ref()
                                .and_then(|source| source.provider_item_id.clone())
                                .unwrap_or_else(|| item_id.to_string()),
                            text: item.text.clone(),
                            parts: parts.clone(),
                        })),
                    )?);
                }
                ItemKind::ToolCall {
                    call_id,
                    name,
                    namespace,
                    ..
                } => {
                    if !item.completed {
                        return Err(HistoryError::IncompleteInput);
                    }
                    let replay_id = history_tool_call_id(*item_id);
                    replay_ids.insert(*call_id, replay_id.clone());
                    let call = ToolCallIntent {
                        call_id: replay_id.clone(),
                        name: name.clone(),
                        raw_arguments_json: item.text.clone(),
                        namespace: namespace.clone(),
                    };
                    messages.push(canonical(
                        *item_id,
                        item,
                        Some(ModelOutputItem::ToolCall(call)),
                    )?);
                    pending.push((*call_id, replay_id));
                }
                ItemKind::ProviderNative { .. } => {
                    if !item.completed {
                        return Err(HistoryError::IncompleteInput);
                    }
                    messages.push(canonical(*item_id, item, None)?);
                }
                ItemKind::ToolResult { call_id, is_error } => {
                    let index = pending
                        .iter()
                        .position(|(id, _)| id == call_id)
                        .ok_or(HistoryError::InvalidOrder)?;
                    pending.remove(index);
                    let replay_id = replay_ids.get(call_id).ok_or(HistoryError::InvalidOrder)?;
                    let (content, error) = if !item.completed {
                        (format!("{}\n{}", item.text, UNKNOWN_RESULT), true)
                    } else if let Some(error) = is_error {
                        (item.text.clone(), *error)
                    } else {
                        (
                            format!(
                                "{}\n[History notice: the original tool success/error status was not recorded.]",
                                item.text
                            ),
                            true,
                        )
                    };
                    messages.push(ModelMessage::ToolResult {
                        call_id: replay_id.clone(),
                        content,
                        is_error: error,
                    });
                }
            }
            if let Some(bodies) = fragments.get(item_id) {
                if !pending.is_empty() {
                    return Err(HistoryError::InvalidOrder);
                }
                messages.extend(bodies.iter().cloned().map(ModelMessage::Developer));
            }
        }
        finish_missing(&mut messages, &mut pending, &results)?;
    }
    Ok(messages)
}

fn canonical(
    id: Uuid,
    item: &crate::protocol::ItemProjection,
    normalized: Option<ModelOutputItem>,
) -> Result<ModelMessage, HistoryError> {
    let native = item
        .source
        .as_ref()
        .and_then(|source| source.provider_data_json.as_deref())
        .map(crate::protocol::NativeItemData::from_json)
        .transpose()?
        .map(Box::new);
    let complete = CompletedModelItem {
        canonical_item_id: Some(id),
        normalized,
        native,
    };
    complete
        .validate()
        .map_err(|_| HistoryError::InvalidOrder)?;
    Ok(ModelMessage::CanonicalOutput(Box::new(complete)))
}

const UNKNOWN_RESULT: &str = "[History notice: no complete durable tool result was recorded. Execution outcome is unknown; this is a synthetic context marker, not an execution result. Reconcile external state before retrying effects.]";

fn finish_missing(
    messages: &mut Vec<ModelMessage>,
    pending: &mut Vec<(Uuid, String)>,
    recorded_results: &HashSet<Uuid>,
) -> Result<(), HistoryError> {
    // A real result later in the timeline cannot be moved across another message.
    if pending.iter().any(|(id, _)| recorded_results.contains(id)) {
        return Err(HistoryError::InvalidOrder);
    }
    for (_, call_id) in pending.drain(..) {
        messages.push(ModelMessage::ToolResult {
            call_id,
            content: UNKNOWN_RESULT.into(),
            is_error: true,
        });
    }
    Ok(())
}
