use super::*;
use crate::protocol::MAX_NATIVE_ITEM_BYTES;

impl ResponseAssembler {
    pub(super) fn record_normalized(&mut self, id: ModelOutputItemId) -> Result<(), ModelError> {
        self.done_items.push(CompletedModelItem {
            canonical_item_id: None,
            normalized: Some(self.item(&id)?),
            native: None,
        });
        Ok(())
    }

    pub(super) fn accept_done(&mut self, mut item: CompletedModelItem) -> Result<(), ModelError> {
        item.validate()?;
        if item.canonical_item_id.is_some() {
            return Err(ModelError::InvalidStream);
        }
        self.native_bytes = self
            .native_bytes
            .checked_add(item.metadata_bytes()?)
            .ok_or(ModelError::BudgetExceeded)?;
        if self.native_bytes > MAX_NATIVE_ITEM_BYTES {
            return Err(ModelError::BudgetExceeded);
        }
        if let Some(native) = &item.native
            && native.item_id.as_ref().is_some_and(|id| {
                self.done_items.iter().any(|old| {
                    old.native.as_ref().and_then(|data| data.item_id.as_ref()) == Some(id)
                })
            })
        {
            return Err(ModelError::InvalidStream);
        }
        match &mut item.normalized {
            Some(ModelOutputItem::ReasoningSummary(summary)) => {
                self.accept_summary(summary.clone())?;
                *self
                    .done_items
                    .last_mut()
                    .ok_or(ModelError::InvalidStream)? = item;
            }
            Some(ModelOutputItem::Message(message)) => {
                if let Some(old) = self.messages.get(&message.item_id) {
                    if old.complete {
                        return Err(ModelError::InvalidStream);
                    }
                    // Codex treats the done item as authoritative. Its body may
                    // correct a streamed draft instead of only extending it.
                    let next_bytes = self
                        .text
                        .len()
                        .checked_sub(old.message.text.len())
                        .and_then(|bytes| bytes.checked_add(message.text.len()))
                        .ok_or(ModelError::BudgetExceeded)?;
                    if next_bytes.saturating_add(self.summary_text_bytes) > self.limits.text_bytes {
                        return Err(ModelError::BudgetExceeded);
                    }
                    self.messages
                        .get_mut(&message.item_id)
                        .ok_or(ModelError::InvalidStream)?
                        .message
                        .text = message.text.clone();
                    // Native messages may interleave deltas. Rebuild their
                    // bounded aggregate without guessing a substring position.
                    self.text = self
                        .output_order
                        .iter()
                        .filter_map(|id| match id {
                            ModelOutputItemId::Message(id) => self.messages.get(id),
                            _ => None,
                        })
                        .map(|pending| pending.message.text.as_str())
                        .collect();
                } else {
                    self.apply(ModelStreamEvent::AssistantMessageStarted {
                        item_id: message.item_id.clone(),
                        phase: message.phase,
                    })?;
                    if !message.text.is_empty() {
                        self.apply(ModelStreamEvent::AssistantTextDelta {
                            item_id: message.item_id.clone(),
                            text: message.text.clone(),
                        })?;
                    }
                }
                self.apply(ModelStreamEvent::AssistantMessageCompleted {
                    item_id: message.item_id.clone(),
                    phase: message.phase,
                })?;
                message.phase = self
                    .messages
                    .get(&message.item_id)
                    .ok_or(ModelError::InvalidStream)?
                    .message
                    .phase;
                *self
                    .done_items
                    .last_mut()
                    .ok_or(ModelError::InvalidStream)? = item;
            }
            Some(ModelOutputItem::ToolCall(call)) => {
                let raw = call.raw_arguments_json.clone();
                if let Some(old) = self.calls.get(&call.call_id) {
                    if old.complete {
                        return Err(ModelError::InvalidStream);
                    }
                    self.argument_bytes = self
                        .argument_bytes
                        .checked_sub(old.json.len())
                        .and_then(|size| size.checked_add(raw.len()))
                        .ok_or(ModelError::BudgetExceeded)?;
                    if self.argument_bytes > self.limits.argument_bytes {
                        return Err(ModelError::BudgetExceeded);
                    }
                } else {
                    self.apply(ModelStreamEvent::ToolCallStarted {
                        call_id: call.call_id.clone(),
                        name: call.name.clone(),
                    })?;
                    self.apply(ModelStreamEvent::ToolArgumentsDelta {
                        call_id: call.call_id.clone(),
                        delta: raw.clone(),
                    })?;
                }
                // Codex builds the invocation from the done payload. Streamed
                // arguments are a draft, not an execution intent or a JSON CAS;
                // only this exact completed string reaches tool validation.
                let pending = self
                    .calls
                    .get_mut(&call.call_id)
                    .ok_or(ModelError::InvalidStream)?;
                pending.name = call.name.clone();
                pending.json = raw.clone();
                pending.namespace = call.namespace.clone();
                self.apply(ModelStreamEvent::ToolCallCompleted {
                    call_id: call.call_id.clone(),
                })?;
                *self
                    .done_items
                    .last_mut()
                    .ok_or(ModelError::InvalidStream)? = item;
            }
            None => self.done_items.push(item),
        }
        Ok(())
    }
}
