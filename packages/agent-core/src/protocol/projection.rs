use super::{
    AgentEvent, AssistantMessagePhase, EventPayload, FailureCategory, ItemKind, ModelIdentity,
    TurnOutcome, TurnPhase,
};
use crate::conversation::{ConversationId, CreateBoundConversation};
use std::collections::{BTreeMap, BTreeSet};
use uuid::Uuid;

#[path = "projection_acceptance.rs"]
mod acceptance;
#[path = "projection_reasoning.rs"]
mod reasoning;
#[path = "projection_recovery.rs"]
mod recovery;
#[path = "projection_rollback.rs"]
mod rollback;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ItemProjection {
    pub kind: ItemKind,
    pub phase: Option<AssistantMessagePhase>,
    pub native_phase: Option<AssistantMessagePhase>,
    pub source: Option<super::CanonicalItemSource>,
    /// Derived from ItemAccepted, including host calls without provider source.
    pub accepted: bool,
    pub text: String,
    pub reasoning_draft: Option<super::ReasoningSummaryDraft>,
    /// Local draft ownership; never inferred from a later canonical source.
    pub model_attempt_id: Option<Uuid>,
    pub completed: bool,
    pub interrupted: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ModelAttemptProjection {
    pub interleaved_tool_results: bool,
    pub requested_model: ModelIdentity,
    pub actual_model: Option<ModelIdentity>,
    pub response_id: Option<String>,
    pub outcome: Option<TurnOutcome>,
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub failure_category: Option<FailureCategory>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TurnProjection {
    pub task_kind: super::TaskKind,
    pub context_snapshot_id: Uuid,
    pub model: ModelIdentity,
    pub phase: TurnPhase,
    pub outcome: Option<TurnOutcome>,
    pub failure: Option<(String, FailureCategory)>,
    pub item_order: Vec<Uuid>,
    ordered_output_items: BTreeSet<Uuid>,
    pub items: BTreeMap<Uuid, ItemProjection>,
    /// Calls whose result owner has not durably acknowledged delivery.
    pub pending_tool_receipts: BTreeSet<Uuid>,
    /// Versioned creation intents accepted before the child side effect.
    pub child_creation_intents: BTreeMap<Uuid, CreateBoundConversation>,
    /// Only version 2 records supply an original child submission identity.
    pub child_submission_requests: BTreeMap<Uuid, Uuid>,
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub attempt_order: Vec<Uuid>,
    pub attempts: BTreeMap<Uuid, ModelAttemptProjection>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ConversationProjection {
    conversation_id: ConversationId,
    seq: u64,
    active_turn: Option<Uuid>,
    turn_order: Vec<Uuid>,
    turns: BTreeMap<Uuid, TurnProjection>,
    turn_start_sequences: BTreeMap<Uuid, u64>,
    item_sequences: BTreeMap<Uuid, (u64, u64)>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ApplyResult {
    Applied,
    AlreadyApplied,
}

impl TurnProjection {
    pub fn outcome(&self) -> Option<TurnOutcome> {
        self.outcome
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, thiserror::Error)]
pub enum ProjectionError {
    #[error("event belongs to another conversation")]
    WrongConversation,
    #[error("event gap: expected {expected}, received {received}")]
    Gap { expected: u64, received: u64 },
    #[error("invalid agent event transition")]
    InvalidTransition,
}

impl ConversationProjection {
    pub fn new(conversation_id: ConversationId) -> Self {
        Self {
            conversation_id,
            seq: 0,
            active_turn: None,
            turn_order: vec![],
            turns: BTreeMap::new(),
            turn_start_sequences: BTreeMap::new(),
            item_sequences: BTreeMap::new(),
        }
    }
    pub fn seq(&self) -> u64 {
        self.seq
    }
    pub fn conversation_id(&self) -> ConversationId {
        self.conversation_id
    }
    pub fn turn_order(&self) -> &[Uuid] {
        &self.turn_order
    }
    pub fn turn(&self, id: Uuid) -> Option<&TurnProjection> {
        self.turns.get(&id)
    }
    pub fn active_turn(&self) -> Option<Uuid> {
        self.active_turn
    }

    /// Rebuild from the authoritative immutable journal. Old seq values are ignored;
    /// a gap requires readSince recovery. Rejected events never partially mutate state.
    /// This projection grants no tool execution permission and starts no side effects.
    pub fn apply(&mut self, event: &AgentEvent) -> Result<ApplyResult, ProjectionError> {
        use ProjectionError::InvalidTransition;
        if event.conversation_id() != self.conversation_id {
            return Err(ProjectionError::WrongConversation);
        }
        if event.seq() <= self.seq {
            return Ok(ApplyResult::AlreadyApplied);
        }
        if event.seq() != self.seq + 1 {
            return Err(ProjectionError::Gap {
                expected: self.seq + 1,
                received: event.seq(),
            });
        }
        if let EventPayload::ConversationRolledBack {
            turn_id,
            user_turns,
        } = event.payload()
        {
            self.rollback(*turn_id, *user_turns)?;
            self.seq = event.seq();
            return Ok(ApplyResult::Applied);
        }
        let turn_id = event.payload().turn_id();
        if let EventPayload::TurnStarted {
            context_snapshot_id,
            model,
            task_kind,
            ..
        } = event.payload()
        {
            if self.active_turn.is_some()
                || self.has_unknown_tool_outcome()
                || self.turn_start_sequences.contains_key(&turn_id)
            {
                return Err(InvalidTransition);
            }
            self.turn_order.push(turn_id);
            self.turns.insert(
                turn_id,
                TurnProjection {
                    task_kind: *task_kind,
                    context_snapshot_id: *context_snapshot_id,
                    model: model.clone(),
                    phase: TurnPhase::Preparing,
                    outcome: None,
                    failure: None,
                    item_order: vec![],
                    pending_tool_receipts: BTreeSet::new(),
                    child_creation_intents: BTreeMap::new(),
                    child_submission_requests: BTreeMap::new(),
                    ordered_output_items: BTreeSet::new(),
                    items: BTreeMap::new(),
                    input_tokens: None,
                    output_tokens: None,
                    attempt_order: vec![],
                    attempts: BTreeMap::new(),
                },
            );
            self.active_turn = Some(turn_id);
        } else {
            if self.active_turn != Some(turn_id) {
                return Err(InvalidTransition);
            }
            if let EventPayload::ChildCreationPrepared {
                child_id,
                operation_id,
                ..
            } = event.payload()
                && self
                    .turns
                    .values()
                    .flat_map(|turn| turn.child_creation_intents.values())
                    .any(|intent| {
                        intent.id.as_uuid() == child_id || intent.operation_id == *operation_id
                    })
            {
                return Err(InvalidTransition);
            }
            if let EventPayload::ItemStarted { item_id, .. } = event.payload()
                && self.item_sequences.contains_key(item_id)
            {
                return Err(InvalidTransition);
            }
            if let EventPayload::ItemAccepted { item_id, .. } = event.payload()
                && self.item_sequences.contains_key(item_id)
                && self
                    .turns
                    .get(&turn_id)
                    .is_none_or(|turn| !turn.items.contains_key(item_id))
            {
                return Err(InvalidTransition);
            }
            let turn = self.turns.get_mut(&turn_id).ok_or(InvalidTransition)?;
            if turn.failure.is_some()
                && !matches!(event.payload(), EventPayload::TurnFinished { .. })
            {
                return Err(InvalidTransition);
            }
            match event.payload() {
                EventPayload::ChildCreationPrepared {
                    call_id,
                    child_id,
                    operation_id,
                    binding,
                    submission_request_id,
                    ..
                } => {
                    if turn.child_creation_intents.contains_key(call_id)
                        || turn.child_creation_intents.values().any(|intent| intent.id.as_uuid() == child_id || intent.operation_id == *operation_id)
                        || !turn.items.values().any(|item| item.accepted && item.completed && matches!(&item.kind,
                            ItemKind::ToolCall { call_id: id, name, namespace: None, provider_call_id: Some(_), .. }
                                if id == call_id && name == "research_spawn_subtask"))
                        || turn.items.values().any(|item| matches!(item.kind,
                            ItemKind::ToolResult { call_id: id, .. } if id == *call_id)) {
                        return Err(InvalidTransition);
                    }
                    turn.child_creation_intents.insert(
                        *call_id,
                        CreateBoundConversation {
                            operation_id: *operation_id,
                            id: ConversationId::from_uuid(*child_id),
                            binding: binding.clone(),
                        },
                    );
                    if let Some(request) = submission_request_id {
                        turn.child_submission_requests.insert(*call_id, *request);
                    }
                }
                EventPayload::ToolReceiptPending { call_id, .. } => {
                    if turn.pending_tool_receipts.contains(call_id)
                        || !turn.items.values().any(|item| {
                            item.completed
                                && matches!(item.kind,
                            ItemKind::ToolCall { call_id: id, .. } if id == *call_id)
                        })
                        || turn.items.values().any(|item| {
                            matches!(item.kind,
                            ItemKind::ToolResult { call_id: id, .. } if id == *call_id)
                        })
                    {
                        return Err(InvalidTransition);
                    }
                    turn.pending_tool_receipts.insert(*call_id);
                }
                EventPayload::ToolReceiptConfirmed { call_id, .. } => {
                    if !turn.pending_tool_receipts.contains(call_id)
                        || !turn.items.values().any(|item| {
                            item.completed
                                && matches!(item.kind,
                            ItemKind::ToolResult { call_id: id, .. } if id == *call_id)
                        })
                    {
                        return Err(InvalidTransition);
                    }
                    turn.pending_tool_receipts.remove(call_id);
                }
                EventPayload::ModelRequestStarted {
                    attempt_id, model, ..
                } => {
                    if turn.phase != TurnPhase::RunningModel
                        || turn.attempts.contains_key(attempt_id)
                        || turn
                            .attempts
                            .values()
                            .any(|attempt| attempt.outcome.is_none())
                    {
                        return Err(InvalidTransition);
                    }
                    turn.attempt_order.push(*attempt_id);
                    turn.attempts.insert(
                        *attempt_id,
                        ModelAttemptProjection {
                            interleaved_tool_results: false,
                            requested_model: model.clone(),
                            actual_model: None,
                            response_id: None,
                            outcome: None,
                            input_tokens: None,
                            output_tokens: None,
                            failure_category: None,
                        },
                    );
                }
                EventPayload::ModelOutputInterleavingStarted { attempt_id, .. } => {
                    if turn.items.values().any(|item| {
                        item.model_attempt_id == Some(*attempt_id)
                            || item
                                .source
                                .as_ref()
                                .is_some_and(|source| source.attempt_id == *attempt_id)
                    }) {
                        return Err(InvalidTransition);
                    }
                    let attempt = turn.attempts.get_mut(attempt_id).ok_or(InvalidTransition)?;
                    if attempt.outcome.is_some()
                        || attempt.response_id.is_some()
                        || attempt.interleaved_tool_results
                    {
                        return Err(InvalidTransition);
                    }
                    attempt.interleaved_tool_results = true;
                }
                EventPayload::ModelResponseStarted {
                    attempt_id,
                    response_id,
                    model,
                    ..
                } => {
                    let attempt = turn.attempts.get_mut(attempt_id).ok_or(InvalidTransition)?;
                    if attempt.outcome.is_some()
                        || attempt.response_id.is_some()
                        || model.as_ref().is_some_and(|model| {
                            attempt.requested_model.provider_id != model.provider_id
                        })
                    {
                        return Err(InvalidTransition);
                    }
                    attempt.response_id = Some(response_id.clone());
                    attempt.actual_model = model.clone();
                }
                EventPayload::ModelIdentityObserved {
                    attempt_id, model, ..
                } => {
                    let attempt = turn.attempts.get_mut(attempt_id).ok_or(InvalidTransition)?;
                    if attempt.outcome.is_some()
                        || attempt.response_id.is_none()
                        || attempt.requested_model.provider_id != model.provider_id
                    {
                        return Err(InvalidTransition);
                    }
                    attempt.actual_model = Some(model.clone());
                }
                EventPayload::ModelRequestFinished {
                    attempt_id,
                    input_tokens,
                    output_tokens,
                    ..
                }
                | EventPayload::ModelCompactionFinished {
                    attempt_id,
                    input_tokens,
                    output_tokens,
                    ..
                } => {
                    let attempt = turn.attempts.get_mut(attempt_id).ok_or(InvalidTransition)?;
                    let standalone = matches!(
                        event.payload(),
                        EventPayload::ModelCompactionFinished { .. }
                    );
                    if attempt.outcome.is_some() || (standalone == attempt.response_id.is_some()) {
                        return Err(InvalidTransition);
                    }
                    attempt.outcome = Some(TurnOutcome::Completed);
                    attempt.input_tokens = *input_tokens;
                    attempt.output_tokens = *output_tokens;
                }
                EventPayload::ModelRequestFailed {
                    attempt_id,
                    category,
                    ..
                } => {
                    let attempt = turn.attempts.get_mut(attempt_id).ok_or(InvalidTransition)?;
                    if attempt.outcome.is_some() {
                        return Err(InvalidTransition);
                    }
                    attempt.outcome = Some(TurnOutcome::Failed);
                    attempt.failure_category = *category;
                    // A failed sample cannot complete its streamed draft. Keep
                    // evidence in the journal, but retire it before another sample.
                    for item in turn.items.values_mut().filter(|item| {
                        !item.completed
                            && (matches!(item.kind, ItemKind::AssistantMessage)
                                || matches!(item.kind, ItemKind::ReasoningSummary { .. })
                                    && item.model_attempt_id == Some(*attempt_id))
                    }) {
                        item.interrupted = true;
                    }
                }
                EventPayload::PhaseChanged { phase, .. } => {
                    if !allowed_phase(turn.phase, *phase) {
                        return Err(InvalidTransition);
                    }
                    turn.phase = *phase;
                }
                EventPayload::ItemStarted { item_id, kind, .. } => {
                    let model_attempt = match kind {
                        ItemKind::ReasoningSummary { .. } => {
                            Some(reasoning::active_attempt(turn).ok_or(InvalidTransition)?)
                        }
                        ItemKind::AssistantMessage => reasoning::active_attempt(turn),
                        _ => None,
                    };
                    match kind {
                        ItemKind::ProviderNative { .. } | ItemKind::HookPrompt { .. } => return Err(InvalidTransition),
                        ItemKind::ToolCall { call_id, provider_call_id, .. } if turn.items.values().any(|item|
                            matches!(&item.kind, ItemKind::ToolCall { call_id: old, provider_call_id: old_provider, .. }
                                if old == call_id || (provider_call_id.is_some() && provider_call_id == old_provider))) => return Err(InvalidTransition),
                        ItemKind::ToolResult { call_id, .. } => {
                            let has_call = turn.items.values().any(|item| item.completed &&
                                matches!(&item.kind, ItemKind::ToolCall { call_id: old, .. } if old == call_id));
                            let has_result = turn.items.values().any(|item|
                                matches!(&item.kind, ItemKind::ToolResult { call_id: old, .. } if old == call_id));
                            if !has_call || has_result { return Err(InvalidTransition); }
                        }
                        _ => {}
                    }
                    acceptance::place_output(turn, *item_id, model_attempt);
                    turn.items.insert(
                        *item_id,
                        ItemProjection {
                            kind: kind.clone(),
                            phase: None,
                            native_phase: None,
                            source: None,
                            accepted: false,
                            text: String::new(),
                            reasoning_draft: matches!(kind, ItemKind::ReasoningSummary { .. })
                                .then(super::ReasoningSummaryDraft::default),
                            model_attempt_id: model_attempt,
                            completed: false,
                            interrupted: false,
                        },
                    );
                }
                EventPayload::TextDelta { item_id, text, .. } => {
                    let item = turn.items.get_mut(item_id).ok_or(InvalidTransition)?;
                    if item.completed
                        || item.interrupted
                        || matches!(
                            item.kind,
                            ItemKind::ContextCompaction
                                | ItemKind::ProviderNative { .. }
                                | ItemKind::ReasoningSummary { .. }
                        )
                    {
                        return Err(InvalidTransition);
                    }
                    item.text.push_str(text);
                }
                EventPayload::ReasoningSummaryPartAdded {
                    item_id,
                    summary_index,
                    ..
                } => {
                    let active = reasoning::active_attempt(turn);
                    reasoning::progress(
                        turn.items.get_mut(item_id).ok_or(InvalidTransition)?,
                        active,
                        summary_index,
                        None,
                    )?;
                }
                EventPayload::ReasoningSummaryDelta {
                    item_id,
                    summary_index,
                    text,
                    ..
                } => {
                    let active = reasoning::active_attempt(turn);
                    reasoning::progress(
                        turn.items.get_mut(item_id).ok_or(InvalidTransition)?,
                        active,
                        summary_index,
                        Some(text),
                    )?;
                }
                EventPayload::ItemAccepted {
                    item_id,
                    kind,
                    text,
                    phase,
                    source,
                    ..
                } => {
                    acceptance::accept(turn, *item_id, kind, text, *phase, source.as_ref())?;
                }
                EventPayload::ItemPhaseChanged {
                    item_id,
                    phase,
                    native,
                    ..
                } => {
                    let item = turn.items.get_mut(item_id).ok_or(InvalidTransition)?;
                    if item.completed
                        || item.interrupted
                        || !matches!(item.kind, ItemKind::AssistantMessage)
                        || item.phase.is_some()
                    {
                        return Err(InvalidTransition);
                    }
                    item.phase = Some(*phase);
                    if *native {
                        item.native_phase = Some(*phase);
                    }
                }
                EventPayload::ModelOutputOrder { item_ids, .. } => {
                    let start = turn
                        .item_order
                        .len()
                        .checked_sub(item_ids.len())
                        .ok_or(InvalidTransition)?;
                    let existing: BTreeSet<_> = turn.item_order[start..].iter().copied().collect();
                    let ordered: BTreeSet<_> = item_ids.iter().copied().collect();
                    if existing != ordered
                        || ordered.len() != item_ids.len()
                        || item_ids.iter().any(|id| {
                            turn.ordered_output_items.contains(id)
                                || turn.items.get(id).is_none_or(|item| {
                                    !item.completed
                                        || item.interrupted
                                        || item.source.is_some()
                                        || !matches!(
                                            item.kind,
                                            ItemKind::AssistantMessage | ItemKind::ToolCall { .. }
                                        )
                                })
                        })
                    {
                        return Err(InvalidTransition);
                    }
                    turn.item_order[start..].copy_from_slice(item_ids);
                    turn.ordered_output_items.extend(item_ids.iter().copied());
                }
                EventPayload::ItemCompleted { item_id, .. } => {
                    let item = turn.items.get_mut(item_id).ok_or(InvalidTransition)?;
                    if item.completed
                        || item.interrupted
                        || matches!(item.kind, ItemKind::ReasoningSummary { .. })
                    {
                        return Err(InvalidTransition);
                    }
                    item.completed = true;
                }
                EventPayload::Usage {
                    input_tokens,
                    output_tokens,
                    ..
                } => {
                    if input_tokens
                        .zip(turn.input_tokens)
                        .is_some_and(|(next, old)| next < old)
                        || output_tokens
                            .zip(turn.output_tokens)
                            .is_some_and(|(next, old)| next < old)
                    {
                        return Err(InvalidTransition);
                    }
                    turn.input_tokens = *input_tokens;
                    turn.output_tokens = *output_tokens;
                }
                EventPayload::TurnFailed {
                    error, category, ..
                } => {
                    if turn.failure.is_some() {
                        return Err(InvalidTransition);
                    }
                    turn.failure = Some((error.clone(), *category));
                }
                EventPayload::TurnFinished { outcome, .. } => {
                    if turn.failure.is_some() && *outcome != TurnOutcome::Failed {
                        return Err(InvalidTransition);
                    }
                    if *outcome == TurnOutcome::Completed && !turn.pending_tool_receipts.is_empty()
                    {
                        return Err(InvalidTransition);
                    }
                    if *outcome == TurnOutcome::Completed
                        && turn
                            .attempts
                            .values()
                            .any(|attempt| attempt.outcome.is_none())
                    {
                        return Err(InvalidTransition);
                    }
                    if *outcome == TurnOutcome::Completed && (turn.items.values().any(|item| !(item.completed || item.interrupted && matches!(item.kind, ItemKind::AssistantMessage|ItemKind::ReasoningSummary{..})))
                        || turn.items.values().any(|item| matches!(&item.kind, ItemKind::ToolCall { call_id, .. }
                            if !turn.items.values().any(|result| result.completed && matches!(&result.kind, ItemKind::ToolResult { call_id: result_id, .. } if result_id == call_id))))) {
                        return Err(InvalidTransition);
                    }
                    for item in turn.items.values_mut().filter(|item| !item.completed) {
                        item.interrupted = true;
                    }
                    for attempt in turn
                        .attempts
                        .values_mut()
                        .filter(|attempt| attempt.outcome.is_none())
                    {
                        attempt.outcome = Some(*outcome);
                    }
                    turn.outcome = Some(*outcome);
                    self.active_turn = None;
                }
                EventPayload::TurnStarted { .. } => return Err(InvalidTransition),
                EventPayload::ConversationRolledBack { .. } => return Err(InvalidTransition),
            }
        }
        match event.payload() {
            EventPayload::TurnStarted { turn_id, .. } => {
                self.turn_start_sequences.insert(*turn_id, event.seq());
            }
            EventPayload::ItemStarted { item_id, .. } => {
                self.item_sequences
                    .insert(*item_id, (event.seq(), event.seq()));
                if let Some(turn) = self.turns.get(&event.payload().turn_id()) {
                    for id in acceptance::reordered_results(turn, *item_id) {
                        if let Some((_, last)) = self.item_sequences.get_mut(&id) {
                            *last = event.seq();
                        }
                    }
                }
            }
            EventPayload::ItemAccepted { item_id, .. } => {
                self.item_sequences
                    .entry(*item_id)
                    .and_modify(|(_, last)| *last = event.seq())
                    .or_insert((event.seq(), event.seq()));
                if let Some(turn) = self.turns.get(&event.payload().turn_id()) {
                    for id in acceptance::reordered_results(turn, *item_id) {
                        if let Some((_, last)) = self.item_sequences.get_mut(&id) {
                            *last = event.seq();
                        }
                    }
                }
            }
            EventPayload::TextDelta { item_id, .. }
            | EventPayload::ReasoningSummaryPartAdded { item_id, .. }
            | EventPayload::ReasoningSummaryDelta { item_id, .. }
            | EventPayload::ItemPhaseChanged { item_id, .. }
            | EventPayload::ItemCompleted { item_id, .. } => {
                if let Some((_, last)) = self.item_sequences.get_mut(item_id) {
                    *last = event.seq();
                }
            }
            EventPayload::ModelOutputOrder { item_ids, .. } => {
                for id in item_ids {
                    if let Some((_, last)) = self.item_sequences.get_mut(id) {
                        *last = event.seq();
                    }
                }
            }
            EventPayload::TurnFinished { turn_id, .. } => {
                if let Some(turn) = self.turns.get(turn_id) {
                    for (id, item) in &turn.items {
                        if item.interrupted
                            && let Some((_, last)) = self.item_sequences.get_mut(id)
                        {
                            *last = event.seq();
                        }
                    }
                }
            }
            _ => {}
        }
        self.seq = event.seq();
        Ok(ApplyResult::Applied)
    }
}

#[path = "projection_context_tail.rs"]
mod context_tail;

fn allowed_phase(from: TurnPhase, to: TurnPhase) -> bool {
    use TurnPhase::*;
    from == to
        || matches!(
            (from, to),
            (Preparing, RunningModel | AwaitingInput)
                | (
                    RunningModel,
                    RunningTools | AwaitingInput | AwaitingApproval
                )
                | (
                    RunningTools,
                    RunningModel | AwaitingInput | AwaitingApproval
                )
                | (
                    AwaitingInput | AwaitingApproval,
                    RunningModel | RunningTools
                )
        )
}
