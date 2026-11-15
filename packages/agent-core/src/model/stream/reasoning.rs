use super::*;
use crate::protocol::{MAX_NATIVE_ITEM_BYTES, ReasoningSummaryDraft, ReasoningSummaryIndex};

pub(super) struct PendingSummary {
    draft: ReasoningSummaryDraft,
    pub(super) complete: Option<ReasoningSummary>,
}
impl ResponseAssembler {
    pub(super) fn start_summary(&mut self, id: String) -> Result<(), ModelError> {
        if self.messages.contains_key(&id) {
            return Err(ModelError::InvalidStream);
        }
        if self.summaries.contains_key(&id) {
            return Ok(());
        }
        if id.is_empty() {
            return Err(ModelError::InvalidStream);
        }
        self.message_id_bytes = self
            .message_id_bytes
            .checked_add(id.len().saturating_add(1))
            .ok_or(ModelError::BudgetExceeded)?;
        if self.message_id_bytes > self.limits.text_bytes {
            return Err(ModelError::BudgetExceeded);
        }
        self.output_order
            .push(ModelOutputItemId::ReasoningSummary(id.clone()));
        self.summary_metadata_bytes = self
            .summary_metadata_bytes
            .checked_add(2)
            .ok_or(ModelError::BudgetExceeded)?;
        if self
            .summary_metadata_bytes
            .saturating_add(self.native_bytes)
            > MAX_NATIVE_ITEM_BYTES
        {
            return Err(ModelError::BudgetExceeded);
        }
        self.summaries.insert(
            id,
            PendingSummary {
                draft: ReasoningSummaryDraft::default(),
                complete: None,
            },
        );
        Ok(())
    }
    pub(super) fn summary_progress(
        &mut self,
        id: &str,
        index: ReasoningSummaryIndex,
        text: Option<&str>,
    ) -> Result<(), ModelError> {
        let Some(pending) = self
            .summaries
            .get_mut(id)
            .filter(|pending| pending.complete.is_none())
        else {
            return Ok(());
        };
        let metadata = pending.draft.metadata_growth(&index);
        self.summary_metadata_bytes = self
            .summary_metadata_bytes
            .checked_add(metadata)
            .ok_or(ModelError::BudgetExceeded)?;
        self.summary_text_bytes = self
            .summary_text_bytes
            .checked_add(text.map_or(0, str::len))
            .ok_or(ModelError::BudgetExceeded)?;
        if self
            .summary_metadata_bytes
            .saturating_add(self.native_bytes)
            > MAX_NATIVE_ITEM_BYTES
            || self.text.len().saturating_add(self.summary_text_bytes) > self.limits.text_bytes
        {
            return Err(ModelError::BudgetExceeded);
        }
        if let Some(text) = text {
            pending.draft.append(index, text);
        } else {
            pending.draft.add_part(index);
        }
        Ok(())
    }
    pub(super) fn accept_summary(&mut self, summary: ReasoningSummary) -> Result<(), ModelError> {
        let id = summary.item_id.clone();
        self.start_summary(id.clone())?;
        let pending = self
            .summaries
            .get_mut(&id)
            .ok_or(ModelError::InvalidStream)?;
        if pending.complete.is_some() {
            return Err(ModelError::InvalidStream);
        }
        self.summary_text_bytes = self
            .summary_text_bytes
            .checked_sub(pending.draft.text_bytes())
            .and_then(|bytes| bytes.checked_add(summary.text.len()))
            .ok_or(ModelError::BudgetExceeded)?;
        self.summary_metadata_bytes = self
            .summary_metadata_bytes
            .checked_sub(pending.draft.metadata_bytes())
            .ok_or(ModelError::InvalidStream)?;
        if self.text.len().saturating_add(self.summary_text_bytes) > self.limits.text_bytes
            || self
                .native_bytes
                .saturating_add(self.summary_metadata_bytes)
                > MAX_NATIVE_ITEM_BYTES
        {
            return Err(ModelError::BudgetExceeded);
        }
        pending.draft = ReasoningSummaryDraft::default();
        pending.complete = Some(summary);
        self.completed_order
            .push(ModelOutputItemId::ReasoningSummary(id.clone()));
        self.record_normalized(ModelOutputItemId::ReasoningSummary(id))
    }
}
