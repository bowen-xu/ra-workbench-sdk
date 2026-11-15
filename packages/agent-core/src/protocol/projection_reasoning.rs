use super::*;
use crate::protocol::{MAX_NATIVE_ITEM_BYTES, ReasoningSummaryIndex};

pub(super) fn progress(
    item: &mut ItemProjection,
    active_attempt: Option<Uuid>,
    index: &ReasoningSummaryIndex,
    text: Option<&str>,
) -> Result<(), ProjectionError> {
    let invalid = ProjectionError::InvalidTransition;
    if item.completed
        || item.interrupted
        || !matches!(item.kind, ItemKind::ReasoningSummary { .. })
        || active_attempt.is_none()
        || item.model_attempt_id != active_attempt
    {
        return Err(invalid);
    }
    let draft = item.reasoning_draft.as_ref().ok_or(invalid)?;
    let extra = draft.metadata_growth(index);
    if draft.metadata_bytes().saturating_add(extra) > MAX_NATIVE_ITEM_BYTES
        || item.text.len().saturating_add(text.map_or(0, str::len)) > MAX_NATIVE_ITEM_BYTES
    {
        return Err(invalid);
    }
    let draft = item.reasoning_draft.as_mut().ok_or(invalid)?;
    if let Some(text) = text {
        draft.append(index.clone(), text);
        if draft.is_last(index) {
            item.text.push_str(text);
        } else {
            item.text = draft.parts().map(|(_, text)| text).collect();
        }
    } else {
        draft.add_part(index.clone());
    }
    Ok(())
}

pub(super) fn active_attempt(turn: &TurnProjection) -> Option<Uuid> {
    turn.attempt_order.last().copied().filter(|id| {
        turn.attempts
            .get(id)
            .is_some_and(|attempt| attempt.outcome.is_none())
    })
}
