use super::*;
use crate::protocol::CanonicalItemSource;

pub(super) fn place_output(turn: &mut TurnProjection, item_id: Uuid, attempt_id: Option<Uuid>) {
    turn.item_order.retain(|id| *id != item_id);
    let before_result = attempt_id.filter(|id| turn.attempts.get(id).is_some_and(|attempt| attempt.interleaved_tool_results)).and_then(|attempt_id| {
        turn.item_order.iter().position(|id| {
            let Some(ItemProjection { kind: ItemKind::ToolResult { call_id, .. }, .. }) = turn.items.get(id) else { return false; };
            turn.items.values().any(|item| matches!(&item.kind, ItemKind::ToolCall { call_id: original, .. } if original == call_id)
                && item.source.as_ref().is_some_and(|source| source.attempt_id == attempt_id))
        })
    });
    turn.item_order
        .insert(before_result.unwrap_or(turn.item_order.len()), item_id);
}

pub(super) fn reordered_results(turn: &TurnProjection, item_id: Uuid) -> Vec<Uuid> {
    let Some(item) = turn.items.get(&item_id) else {
        return vec![];
    };
    let attempt_id = item
        .source
        .as_ref()
        .map(|source| source.attempt_id)
        .or(item.model_attempt_id);
    let Some(attempt_id) = attempt_id.filter(|id| {
        turn.attempts
            .get(id)
            .is_some_and(|attempt| attempt.interleaved_tool_results)
    }) else {
        return vec![];
    };
    let Some(position) = turn.item_order.iter().position(|id| *id == item_id) else {
        return vec![];
    };
    turn.item_order[position + 1..].iter().copied().filter(|id| {
        let Some(ItemProjection { kind: ItemKind::ToolResult { call_id, .. }, .. }) = turn.items.get(id) else { return false; };
        turn.items.values().any(|item| matches!(&item.kind, ItemKind::ToolCall { call_id: original, .. } if original == call_id)
            && item.source.as_ref().is_some_and(|source| source.attempt_id == attempt_id))
    }).collect()
}

/// Validate everything before replacing a draft or changing its canonical order.
pub(super) fn accept(
    turn: &mut TurnProjection,
    item_id: Uuid,
    kind: &ItemKind,
    text: &str,
    phase: Option<AssistantMessagePhase>,
    source: Option<&CanonicalItemSource>,
) -> Result<(), ProjectionError> {
    use ProjectionError::InvalidTransition;
    let replacing_summary = turn.items.get(&item_id).is_some_and(|old| {
        matches!(old.kind, ItemKind::ReasoningSummary { .. })
            && matches!(kind, ItemKind::ReasoningSummary { .. })
    });
    let draft_attempt = turn
        .items
        .get(&item_id)
        .and_then(|old| old.model_attempt_id);
    if replacing_summary
        && source
            .is_some_and(|source| draft_attempt.is_some_and(|owner| owner != source.attempt_id))
    {
        return Err(InvalidTransition);
    }
    if matches!(kind, ItemKind::AssistantMessage)
        && turn.items.contains_key(&item_id)
        && source.is_some_and(|source| draft_attempt != Some(source.attempt_id))
    {
        return Err(InvalidTransition);
    }
    let replacing_assistant = matches!(kind, ItemKind::AssistantMessage)
        && turn.items.get(&item_id).is_some_and(|old| {
            matches!(old.kind, ItemKind::AssistantMessage)
                && source.is_some_and(|source| old.model_attempt_id == Some(source.attempt_id))
        });
    if let Some(old) = turn.items.get(&item_id)
        && (old.completed
            || old.interrupted
            || (!replacing_summary
                && !replacing_assistant
                && (old.kind != *kind || old.text != text))
            || (!replacing_assistant
                && old
                    .native_phase
                    .zip(phase)
                    .is_some_and(|(old, next)| old != next)))
    {
        return Err(InvalidTransition);
    }
    if let Some(source) = source {
        let attempt = turn
            .attempts
            .get(&source.attempt_id)
            .ok_or(InvalidTransition)?;
        let previous = turn
            .items
            .values()
            .filter_map(|item| item.source.as_ref())
            .filter(|old| old.attempt_id == source.attempt_id)
            .collect::<Vec<_>>();
        if attempt.outcome.is_some()
            || attempt.response_id.is_none()
            || previous.len() != source.ordinal as usize
            || previous.iter().any(|old| {
                source.provider_item_id.is_some() && old.provider_item_id == source.provider_item_id
            })
            || !matches!(
                kind,
                ItemKind::AssistantMessage
                    | ItemKind::ReasoningSummary { .. }
                    | ItemKind::ToolCall { .. }
                    | ItemKind::ProviderNative { .. }
            )
        {
            return Err(InvalidTransition);
        }
    }
    match kind {
        ItemKind::ToolCall { call_id, provider_call_id, .. } => {
            if turn.items.iter().any(|(id, item)| *id != item_id && matches!(&item.kind,
                ItemKind::ToolCall { call_id: old, provider_call_id: old_provider, .. }
                if old == call_id || (provider_call_id.is_some() && old_provider == provider_call_id))) {
                return Err(InvalidTransition);
            }
        }
        ItemKind::ToolResult { call_id, .. } => {
            let has_call = turn.items.values().any(|item| item.completed && matches!(item.kind,
                ItemKind::ToolCall { call_id: old, .. } if old == *call_id));
            let has_result = turn.items.iter().any(|(id, item)| *id != item_id && matches!(item.kind,
                ItemKind::ToolResult { call_id: old, .. } if old == *call_id));
            if !has_call || has_result { return Err(InvalidTransition); }
        }
        ItemKind::AssistantMessage => {}
        ItemKind::HookPrompt { .. } => {
            if turn.items.contains_key(&item_id) || !text.is_empty() || phase.is_some() || source.is_some() {
                return Err(InvalidTransition);
            }
        }
        ItemKind::ReasoningSummary{parts} => {
            if phase.is_some()||!crate::protocol::validate_summary_parts(text,parts){return Err(InvalidTransition);}
        }
        ItemKind::ProviderNative { item_type } => {
            let native=source.and_then(|value|value.provider_data_json.as_deref())
                .and_then(|json|crate::protocol::NativeItemData::from_json(json).ok()).ok_or(InvalidTransition)?;
            if !text.is_empty() || phase.is_some() || native.item_type!=*item_type
                || matches!(item_type.as_str(),"message"|"function_call") { return Err(InvalidTransition); }
        }
        _ => return Err(InvalidTransition),
    }
    let native_phase =
        phase.or_else(|| turn.items.get(&item_id).and_then(|item| item.native_phase));
    let phase = phase.or_else(|| turn.items.get(&item_id).and_then(|item| item.phase));
    turn.items.insert(
        item_id,
        ItemProjection {
            kind: kind.clone(),
            text: text.into(),
            reasoning_draft: None,
            model_attempt_id: if matches!(
                kind,
                ItemKind::ReasoningSummary { .. } | ItemKind::AssistantMessage
            ) {
                source.map(|source| source.attempt_id).or(draft_attempt)
            } else {
                None
            },
            phase,
            native_phase,
            source: source.cloned(),
            accepted: true,
            completed: true,
            interrupted: false,
        },
    );
    // Admission order is frozen at item done, never rewritten by response.done.
    if source.is_some() || !turn.item_order.contains(&item_id) {
        place_output(turn, item_id, source.map(|value| value.attempt_id));
    }
    Ok(())
}
