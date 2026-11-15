// Adapted from Codex core/src/session/turn.rs response-event handling (Apache-2.0).
// Copyright 2025 OpenAI. Local differences: provider-neutral events and budgets.
use super::*;
use crate::protocol::ModelIdentity;
use std::collections::{BTreeMap, BTreeSet};
mod done;
mod reasoning;

#[derive(Clone, Copy)]
pub struct StreamLimits {
    pub text_bytes: usize,
    pub argument_bytes: usize,
    pub tool_calls: usize,
}

struct PendingCall {
    name: String,
    namespace: Option<String>,
    json: String,
    complete: bool,
}
struct PendingMessage {
    message: AssistantMessage,
    complete: bool,
}

pub struct ResponseAssembler {
    limits: StreamLimits,
    started: Option<(String, ModelIdentity)>,
    requested_model: Option<ModelIdentity>,
    model_observed: bool,
    text: String,
    calls: BTreeMap<String, PendingCall>,
    call_order: Vec<String>,
    messages: BTreeMap<String, PendingMessage>,
    summaries: BTreeMap<String, reasoning::PendingSummary>,
    summary_text_bytes: usize,
    summary_metadata_bytes: usize,
    message_id_bytes: usize,
    output_order: Vec<ModelOutputItemId>,
    completed_order: Vec<ModelOutputItemId>,
    order_received: bool,
    argument_bytes: usize,
    usage: ModelUsage,
    completed: Option<FinishReason>,
    end_turn: Option<bool>,
    failed: bool,
    done_items: Vec<CompletedModelItem>,
    native_bytes: usize,
}

impl ResponseAssembler {
    pub fn new(limits: StreamLimits) -> Result<Self, ModelError> {
        if limits.text_bytes == 0 || limits.argument_bytes == 0 || limits.tool_calls == 0 {
            return Err(ModelError::InvalidRequest);
        }
        Ok(Self {
            limits,
            started: None,
            requested_model: None,
            model_observed: false,
            text: String::new(),
            calls: BTreeMap::new(),
            call_order: vec![],
            messages: BTreeMap::new(),
            summaries: BTreeMap::new(),
            summary_text_bytes: 0,
            summary_metadata_bytes: 0,
            message_id_bytes: 0,
            output_order: vec![],
            completed_order: vec![],
            order_received: false,
            argument_bytes: 0,
            usage: ModelUsage::default(),
            completed: None,
            end_turn: None,
            failed: false,
            done_items: vec![],
            native_bytes: 0,
        })
    }
    pub fn partial_text(&self) -> &str {
        &self.text
    }
    pub fn with_requested_model(mut self, model: ModelIdentity) -> Self {
        self.requested_model = Some(model);
        self
    }

    /// A validated item is usable at its done boundary, even if later IO fails.
    pub fn completed_item(
        &self,
        event: &ModelStreamEvent,
    ) -> Result<Option<CompletedModelItem>, ModelError> {
        if matches!(event, ModelStreamEvent::OutputItemDone(_)) {
            return self
                .done_items
                .last()
                .cloned()
                .map(Some)
                .ok_or(ModelError::InvalidStream);
        }
        let id = match event {
            ModelStreamEvent::AssistantMessageCompleted { item_id, .. } => {
                ModelOutputItemId::Message(item_id.clone())
            }
            ModelStreamEvent::ToolCallCompleted { call_id } => {
                ModelOutputItemId::ToolCall(call_id.clone())
            }
            _ => return Ok(None),
        };
        self.item(&id).map(|normalized| {
            Some(CompletedModelItem {
                canonical_item_id: None,
                normalized: Some(normalized),
                native: None,
            })
        })
    }
    pub fn completed_items(&self) -> Vec<CompletedModelItem> {
        self.done_items.clone()
    }
    fn item(&self, id: &ModelOutputItemId) -> Result<ModelOutputItem, ModelError> {
        match id {
            ModelOutputItemId::ReasoningSummary(id) => self
                .summaries
                .get(id)
                .and_then(|pending| pending.complete.clone())
                .map(ModelOutputItem::ReasoningSummary)
                .ok_or(ModelError::InvalidStream),
            ModelOutputItemId::Message(id) => self
                .messages
                .get(id)
                .filter(|item| item.complete)
                .map(|item| ModelOutputItem::Message(item.message.clone()))
                .ok_or(ModelError::InvalidStream),
            ModelOutputItemId::ToolCall(id) => {
                let call = self
                    .calls
                    .get(id)
                    .filter(|call| call.complete)
                    .ok_or(ModelError::InvalidStream)?;
                Ok(ModelOutputItem::ToolCall(ToolCallIntent {
                    call_id: id.clone(),
                    name: call.name.clone(),
                    raw_arguments_json: call.json.clone(),
                    namespace: call.namespace.clone(),
                }))
            }
        }
    }

    pub fn push(&mut self, event: ModelStreamEvent) -> Result<(), ModelError> {
        let result = self.apply(event);
        if result.is_err() {
            self.failed = true;
        }
        result
    }

    fn apply(&mut self, event: ModelStreamEvent) -> Result<(), ModelError> {
        if self.failed || self.completed.is_some() {
            return Err(ModelError::InvalidStream);
        }
        if let ModelStreamEvent::StartedWithoutModel { response_id } = event {
            let model = self
                .requested_model
                .clone()
                .ok_or(ModelError::InvalidStream)?;
            if self.started.is_some() || response_id.is_empty() {
                return Err(ModelError::InvalidStream);
            }
            self.started = Some((response_id, model));
            return Ok(());
        }
        if let ModelStreamEvent::Started {
            response_id,
            actual_model,
        } = event
        {
            if self.started.is_some()
                || response_id.is_empty()
                || actual_model.model_id.trim().is_empty()
                || actual_model.provider_id.trim().is_empty()
            {
                return Err(ModelError::InvalidStream);
            }
            self.started = Some((response_id, actual_model));
            self.model_observed = true;
            return Ok(());
        }
        if self.started.is_none() {
            return Err(ModelError::InvalidStream);
        }
        if self.order_received
            && !matches!(
                &event,
                ModelStreamEvent::Usage(_) | ModelStreamEvent::Completed { .. }
            )
        {
            return Err(ModelError::InvalidStream);
        }
        match event {
            ModelStreamEvent::ModelIdentityObserved(model) => {
                let (_, old) = self.started.as_mut().ok_or(ModelError::InvalidStream)?;
                if model.provider_id != old.provider_id || model.model_id.trim().is_empty() {
                    return Err(ModelError::InvalidStream);
                }
                *old = model;
                self.model_observed = true;
            }
            ModelStreamEvent::TextDelta(delta) => {
                if !self.messages.is_empty() {
                    return Err(ModelError::InvalidStream);
                }
                if self
                    .text
                    .len()
                    .saturating_add(self.summary_text_bytes)
                    .saturating_add(delta.len())
                    > self.limits.text_bytes
                {
                    return Err(ModelError::BudgetExceeded);
                }
                self.text.push_str(&delta);
            }
            ModelStreamEvent::AssistantMessageStarted { item_id, phase } => {
                if item_id.is_empty()
                    || self.messages.contains_key(&item_id)
                    || self.summaries.contains_key(&item_id)
                    || (!self.text.is_empty() && self.messages.is_empty())
                    || phase == Some(crate::protocol::AssistantMessagePhase::Reasoning)
                {
                    return Err(ModelError::InvalidStream);
                }
                self.message_id_bytes = self
                    .message_id_bytes
                    .checked_add(item_id.len().saturating_add(1))
                    .ok_or(ModelError::BudgetExceeded)?;
                if self.message_id_bytes > self.limits.text_bytes {
                    return Err(ModelError::BudgetExceeded);
                }
                self.output_order
                    .push(ModelOutputItemId::Message(item_id.clone()));
                self.messages.insert(
                    item_id.clone(),
                    PendingMessage {
                        message: AssistantMessage {
                            item_id,
                            text: String::new(),
                            phase,
                        },
                        complete: false,
                    },
                );
            }
            ModelStreamEvent::AssistantTextDelta { item_id, text } => {
                let pending = self
                    .messages
                    .get_mut(&item_id)
                    .ok_or(ModelError::InvalidStream)?;
                if pending.complete {
                    return Err(ModelError::InvalidStream);
                }
                if self
                    .text
                    .len()
                    .saturating_add(self.summary_text_bytes)
                    .saturating_add(text.len())
                    > self.limits.text_bytes
                {
                    return Err(ModelError::BudgetExceeded);
                }
                pending.message.text.push_str(&text);
                self.text.push_str(&text);
            }
            ModelStreamEvent::AssistantMessageCompleted { item_id, phase } => {
                let pending = self
                    .messages
                    .get_mut(&item_id)
                    .ok_or(ModelError::InvalidStream)?;
                if pending.complete
                    || phase == Some(crate::protocol::AssistantMessagePhase::Reasoning)
                {
                    return Err(ModelError::InvalidStream);
                }
                pending.message.phase = phase.or(pending.message.phase);
                pending.complete = true;
                self.completed_order
                    .push(ModelOutputItemId::Message(item_id.clone()));
                self.record_normalized(ModelOutputItemId::Message(item_id))?;
            }
            ModelStreamEvent::OutputItemDone(item) => self.accept_done(*item)?,
            ModelStreamEvent::ReasoningSummaryStarted { item_id } => self.start_summary(item_id)?,
            ModelStreamEvent::ReasoningSummaryPartAdded {
                item_id,
                summary_index,
            } => self.summary_progress(&item_id, summary_index, None)?,
            ModelStreamEvent::ReasoningSummaryDelta {
                item_id,
                summary_index,
                text,
            } => self.summary_progress(&item_id, summary_index, Some(&text))?,
            ModelStreamEvent::OutputOrder(order) => {
                let expected: BTreeSet<_> = self.output_order.iter().cloned().collect();
                let actual: BTreeSet<_> = order.iter().cloned().collect();
                if order.len() != self.output_order.len()
                    || order.len() != actual.len()
                    || expected != actual
                    || (!self.completed_order.is_empty() && order != self.completed_order)
                {
                    return Err(ModelError::InvalidStream);
                }
                self.output_order = order;
                self.order_received = true;
            }
            ModelStreamEvent::ToolCallStarted { call_id, name } => {
                super::tool_intent::validate_identity(&call_id, &name)?;
                if self.calls.contains_key(&call_id) {
                    return Err(ModelError::InvalidStream);
                }
                if self.calls.len() >= self.limits.tool_calls {
                    return Err(ModelError::BudgetExceeded);
                }
                self.call_order.push(call_id.clone());
                self.output_order
                    .push(ModelOutputItemId::ToolCall(call_id.clone()));
                self.calls.insert(
                    call_id,
                    PendingCall {
                        name,
                        namespace: None,
                        json: String::new(),
                        complete: false,
                    },
                );
            }
            ModelStreamEvent::ToolArgumentsDelta { call_id, delta } => {
                let call = self
                    .calls
                    .get_mut(&call_id)
                    .ok_or(ModelError::InvalidStream)?;
                if call.complete {
                    return Err(ModelError::InvalidStream);
                }
                if self.argument_bytes.saturating_add(delta.len()) > self.limits.argument_bytes {
                    return Err(ModelError::BudgetExceeded);
                }
                self.argument_bytes += delta.len();
                call.json.push_str(&delta);
            }
            ModelStreamEvent::ToolCallCompleted { call_id } => {
                let call = self
                    .calls
                    .get_mut(&call_id)
                    .ok_or(ModelError::InvalidStream)?;
                if call.complete {
                    return Err(ModelError::InvalidStream);
                }
                call.complete = true;
                self.completed_order
                    .push(ModelOutputItemId::ToolCall(call_id.clone()));
                self.record_normalized(ModelOutputItemId::ToolCall(call_id))?;
            }
            ModelStreamEvent::Usage(usage) => {
                if usage
                    .input_tokens
                    .zip(self.usage.input_tokens)
                    .is_some_and(|(next, old)| next < old)
                    || usage
                        .output_tokens
                        .zip(self.usage.output_tokens)
                        .is_some_and(|(next, old)| next < old)
                {
                    return Err(ModelError::InvalidStream);
                }
                self.usage.input_tokens = usage.input_tokens.or(self.usage.input_tokens);
                self.usage.output_tokens = usage.output_tokens.or(self.usage.output_tokens);
            }
            ModelStreamEvent::Completed { reason, end_turn } => {
                if matches!(reason, FinishReason::Stop | FinishReason::ToolCalls)
                    && (self.calls.values().any(|call| !call.complete)
                        || self.messages.values().any(|message| !message.complete))
                    || (matches!(reason, FinishReason::Stop | FinishReason::ToolCalls)
                        && self
                            .summaries
                            .values()
                            .any(|summary| summary.complete.is_none()))
                {
                    return Err(ModelError::IncompleteStream);
                }
                if (reason == FinishReason::ToolCalls) == self.calls.is_empty()
                    && matches!(reason, FinishReason::Stop | FinishReason::ToolCalls)
                {
                    return Err(ModelError::InvalidStream);
                }
                self.completed = Some(reason);
                self.end_turn = end_turn;
            }
            ModelStreamEvent::Started { .. } | ModelStreamEvent::StartedWithoutModel { .. } => {
                return Err(ModelError::InvalidStream);
            }
        }
        Ok(())
    }

    /// EOF without Completed is an error, as in Codex. Failure here does not
    /// retract items already returned by completed_item and durably accepted.
    pub fn finish(mut self) -> Result<ModelResponse, ModelError> {
        if self.failed {
            return Err(ModelError::InvalidStream);
        }
        match self.completed.ok_or(ModelError::IncompleteStream)? {
            FinishReason::Length => return Err(ModelError::Truncated),
            FinishReason::Filtered => return Err(ModelError::Filtered),
            _ => {}
        }
        let (response_id, actual_model) = self.started.ok_or(ModelError::IncompleteStream)?;
        let mut calls = self.calls;
        let tool_calls = self
            .call_order
            .into_iter()
            .map(|call_id| {
                let call = calls.remove(&call_id).ok_or(ModelError::InvalidStream)?;
                Ok(ToolCallIntent {
                    call_id,
                    name: call.name,
                    raw_arguments_json: call.json,
                    namespace: call.namespace,
                })
            })
            .collect::<Result<Vec<_>, ModelError>>()?;
        let calls_by_id: BTreeMap<_, _> = tool_calls
            .iter()
            .map(|call| (call.call_id.as_str(), call))
            .collect();
        let output = self
            .completed_order
            .into_iter()
            .map(|item| match item {
                ModelOutputItemId::Message(id) => self
                    .messages
                    .remove(&id)
                    .map(|pending| ModelOutputItem::Message(pending.message))
                    .ok_or(ModelError::InvalidStream),
                ModelOutputItemId::ToolCall(id) => calls_by_id
                    .get(id.as_str())
                    .map(|call| ModelOutputItem::ToolCall((*call).clone()))
                    .ok_or(ModelError::InvalidStream),
                ModelOutputItemId::ReasoningSummary(id) => self
                    .summaries
                    .remove(&id)
                    .and_then(|pending| pending.complete)
                    .map(ModelOutputItem::ReasoningSummary)
                    .ok_or(ModelError::InvalidStream),
            })
            .collect::<Result<Vec<_>, _>>()?;
        let tool_calls = output
            .iter()
            .filter_map(|item| match item {
                ModelOutputItem::ToolCall(call) => Some(call.clone()),
                ModelOutputItem::Message(_) | ModelOutputItem::ReasoningSummary(_) => None,
            })
            .collect();
        let text = if self.messages.is_empty() {
            // The map was drained above. The output list distinguishes native
            // message items from the legacy aggregate Chat stream.
            if output
                .iter()
                .any(|item| matches!(item, ModelOutputItem::Message(_)))
            {
                output
                    .iter()
                    .filter_map(|item| match item {
                        ModelOutputItem::Message(message) => Some(message.text.as_str()),
                        _ => None,
                    })
                    .collect()
            } else {
                self.text
            }
        } else {
            return Err(ModelError::InvalidStream);
        };
        Ok(ModelResponse {
            response_id,
            actual_model,
            actual_model_observed: self.model_observed,
            text,
            output,
            tool_calls,
            usage: self.usage,
            end_turn: self.end_turn,
        })
    }
}
