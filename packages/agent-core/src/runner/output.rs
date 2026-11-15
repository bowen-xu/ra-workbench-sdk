//! Codex output-item completion is the canonical boundary. Draft UI fragments
//! never authorize execution or enter model replay until their item is accepted.
use super::*;
use crate::protocol::CanonicalItemSource;
use std::collections::HashMap;
mod reasoning;

pub(super) struct OutputItems {
    legacy: Option<Uuid>,
    native: HashMap<String, Uuid>,
    native_text: HashMap<String, String>,
    summaries: HashMap<String, reasoning::SummaryOutput>,
    ordinal: u32,
}

impl OutputItems {
    pub(super) fn new() -> Self {
        Self {
            legacy: None,
            native: HashMap::new(),
            native_text: HashMap::new(),
            summaries: HashMap::new(),
            ordinal: 0,
        }
    }

    pub(super) fn text_growth(&self, event: &ModelStreamEvent) -> Result<usize, ModelError> {
        match event {
            ModelStreamEvent::ReasoningSummaryDelta { item_id, text, .. } => Ok(self
                .summaries
                .get(item_id)
                .filter(|item| !item.complete)
                .map_or(0, |_| text.len())),
            ModelStreamEvent::TextDelta(text)
            | ModelStreamEvent::AssistantTextDelta { text, .. } => Ok(text.len()),
            ModelStreamEvent::OutputItemDone(item) => {
                if let Some(ModelOutputItem::ReasoningSummary(summary)) = &item.normalized {
                    return Ok(self.summaries.get(&summary.item_id).map_or(
                        summary.text.len(),
                        |item| {
                            item.draft
                                .additional_final_bytes(&summary.text, &summary.parts)
                        },
                    ));
                }
                let Some(ModelOutputItem::Message(message)) = &item.normalized else {
                    return Ok(0);
                };
                let previous = self
                    .native_text
                    .get(&message.item_id)
                    .map(String::as_str)
                    .unwrap_or_default();
                Ok(message
                    .text
                    .strip_prefix(previous)
                    .map_or(message.text.len(), str::len))
            }
            _ => Ok(0),
        }
    }

    pub(super) async fn observe(
        &mut self,
        runner: &TurnRunner<'_>,
        turn_id: Uuid,
        event: &ModelStreamEvent,
    ) -> Result<(), RunError> {
        match event {
            ModelStreamEvent::ReasoningSummaryStarted { .. }
            | ModelStreamEvent::ReasoningSummaryPartAdded { .. }
            | ModelStreamEvent::ReasoningSummaryDelta { .. } => {
                self.observe_summary(runner, turn_id, event).await?
            }
            ModelStreamEvent::TextDelta(text) if !text.is_empty() => {
                let item_id = if let Some(id) = self.legacy {
                    id
                } else {
                    let id = runner.ids.next_id();
                    runner
                        .sink
                        .emit(EventPayload::ItemStarted {
                            turn_id,
                            item_id: id,
                            kind: ItemKind::AssistantMessage,
                        })
                        .await?;
                    self.legacy = Some(id);
                    id
                };
                runner.emit_text(turn_id, item_id, text).await?;
            }
            ModelStreamEvent::AssistantMessageStarted { item_id, phase } => {
                let id = runner.ids.next_id();
                self.native.insert(item_id.clone(), id);
                self.native_text.insert(item_id.clone(), String::new());
                runner
                    .sink
                    .emit(EventPayload::ItemStarted {
                        turn_id,
                        item_id: id,
                        kind: ItemKind::AssistantMessage,
                    })
                    .await?;
                if let Some(phase) = phase {
                    runner
                        .sink
                        .emit(EventPayload::ItemPhaseChanged {
                            turn_id,
                            item_id: id,
                            phase: *phase,
                            native: true,
                        })
                        .await?;
                }
            }
            ModelStreamEvent::AssistantTextDelta { item_id, text } => {
                let id = self
                    .native
                    .get(item_id)
                    .copied()
                    .ok_or(ModelError::InvalidStream)?;
                runner.emit_text(turn_id, id, text).await?;
                self.native_text
                    .get_mut(item_id)
                    .ok_or(ModelError::InvalidStream)?
                    .push_str(text);
            }
            ModelStreamEvent::OutputItemDone(item) => {
                if let Some(ModelOutputItem::Message(message)) = &item.normalized
                    && let Some(id) = self.native.get(&message.item_id).copied()
                {
                    let old = self
                        .native_text
                        .get(&message.item_id)
                        .ok_or(ModelError::InvalidStream)?;
                    // A correction is installed by the atomic ItemAccepted,
                    // never appended to the existing visible draft as a delta.
                    if let Some(remaining) = message.text.strip_prefix(old)
                        && !remaining.is_empty()
                    {
                        runner.emit_text(turn_id, id, remaining).await?;
                    }
                    self.native_text
                        .insert(message.item_id.clone(), message.text.clone());
                }
            }
            _ => {}
        }
        Ok(())
    }

    pub(super) async fn accept(
        &mut self,
        runner: &TurnRunner<'_>,
        turn_id: Uuid,
        attempt_id: Uuid,
        item: &CompletedModelItem,
        call_id: Option<Uuid>,
    ) -> Result<Uuid, RunError> {
        item.validate()?;
        let (item_id, kind, text, phase, provider_item_id) = match &item.normalized {
            Some(ModelOutputItem::ReasoningSummary(summary)) => {
                let id = if let Some(draft) = self.summaries.get_mut(&summary.item_id) {
                    draft.complete = true;
                    draft.draft = crate::protocol::ReasoningSummaryDraft::default();
                    draft.id
                } else {
                    let id = runner.ids.next_id();
                    // Sparse done items close the same identity as streamed
                    // drafts. Late progress must not manufacture another item.
                    self.summaries.insert(
                        summary.item_id.clone(),
                        reasoning::SummaryOutput {
                            id,
                            draft: crate::protocol::ReasoningSummaryDraft::default(),
                            complete: true,
                        },
                    );
                    id
                };
                (
                    id,
                    ItemKind::ReasoningSummary {
                        parts: summary.parts.clone(),
                    },
                    summary.text.clone(),
                    None,
                    Some(summary.item_id.clone()),
                )
            }
            Some(ModelOutputItem::Message(message)) => (
                self.native
                    .get(&message.item_id)
                    .copied()
                    .unwrap_or_else(|| runner.ids.next_id()),
                ItemKind::AssistantMessage,
                message.text.clone(),
                message.phase,
                Some(message.item_id.clone()),
            ),
            Some(ModelOutputItem::ToolCall(call)) => (
                runner.ids.next_id(),
                ItemKind::ToolCall {
                    call_id: call_id.ok_or(RunError::EventSink)?,
                    name: call.name.clone(),
                    provider_call_id: Some(call.call_id.clone()),
                    namespace: call.namespace.clone(),
                },
                call.raw_arguments_json.clone(),
                None,
                item.native.as_ref().and_then(|data| data.item_id.clone()),
            ),
            None => {
                let native = item.native.as_ref().ok_or(ModelError::InvalidStream)?;
                (
                    runner.ids.next_id(),
                    ItemKind::ProviderNative {
                        item_type: native.item_type.clone(),
                    },
                    String::new(),
                    None,
                    native.item_id.clone(),
                )
            }
        };
        // Fresh admission must fit the existing IPC source identity. Keep the
        // wider historical/native codec contract readable; classify capacity
        // here before an event sink could misreport it as persistence failure.
        if let Some(provider_id) = &provider_item_id {
            if provider_id.trim().is_empty() {
                return Err(ModelError::InvalidStream.into());
            }
            if provider_id.chars().count() > crate::protocol::MAX_EVENT_NAME_CHARS {
                return Err(ModelError::BudgetExceeded.into());
            }
        }
        runner
            .sink
            .emit(EventPayload::ItemAccepted {
                turn_id,
                item_id,
                kind,
                text,
                phase,
                source: Some(CanonicalItemSource {
                    attempt_id,
                    ordinal: self.ordinal,
                    provider_item_id,
                    provider_data_json: item
                        .native
                        .as_ref()
                        .map(|data| data.to_json())
                        .transpose()
                        .map_err(|_| ModelError::InvalidStream)?,
                }),
            })
            .await?;
        self.ordinal = self.ordinal.checked_add(1).ok_or(RunError::Budget)?;
        Ok(item_id)
    }

    pub(super) async fn complete_legacy(
        &self,
        runner: &TurnRunner<'_>,
        turn_id: Uuid,
        response: &ModelResponse,
    ) -> Result<(), RunError> {
        if let Some(item_id) = self.legacy {
            runner
                .sink
                .emit(EventPayload::ItemPhaseChanged {
                    turn_id,
                    item_id,
                    phase: if !response.tool_calls.is_empty() || response.end_turn == Some(false) {
                        AssistantMessagePhase::Commentary
                    } else {
                        AssistantMessagePhase::FinalAnswer
                    },
                    native: false,
                })
                .await?;
            runner
                .sink
                .emit(EventPayload::ItemAccepted {
                    turn_id,
                    item_id,
                    kind: ItemKind::AssistantMessage,
                    text: response.text.clone(),
                    phase: None,
                    source: None,
                })
                .await?;
        }
        Ok(())
    }
}

pub(super) fn append_item(request: &mut ModelRequest, mut item: CompletedModelItem, id: Uuid) {
    item.canonical_item_id = Some(id);
    request
        .messages
        .push(ModelMessage::CanonicalOutput(Box::new(item)));
}

pub(super) fn append_legacy(request: &mut ModelRequest, response: &ModelResponse, start: usize) {
    if !response.text.is_empty()
        && !response
            .output
            .iter()
            .any(|item| matches!(item, ModelOutputItem::Message(_)))
    {
        // Chat exposes one text accumulator, before its completed function calls.
        request.messages.insert(
            start,
            ModelMessage::Assistant {
                content: text_parts(&response.text),
                tool_calls: vec![],
                phase: None,
            },
        );
    }
}

fn text_parts(text: &str) -> Vec<ContentPart> {
    if text.is_empty() {
        vec![]
    } else {
        vec![ContentPart::Text(text.into())]
    }
}
