use super::*;
use crate::protocol::ReasoningSummaryDraft;

pub(super) struct SummaryOutput {
    pub(super) id: Uuid,
    pub(super) draft: ReasoningSummaryDraft,
    pub(super) complete: bool,
}
impl OutputItems {
    pub(super) async fn observe_summary(
        &mut self,
        runner: &TurnRunner<'_>,
        turn_id: Uuid,
        event: &ModelStreamEvent,
    ) -> Result<(), RunError> {
        if let ModelStreamEvent::ReasoningSummaryStarted { item_id } = event {
            if self.summaries.contains_key(item_id) {
                return Ok(());
            }
            let id = runner.ids.next_id();
            runner
                .sink
                .emit(EventPayload::ItemStarted {
                    turn_id,
                    item_id: id,
                    kind: ItemKind::ReasoningSummary { parts: vec![] },
                })
                .await?;
            self.summaries.insert(
                item_id.clone(),
                SummaryOutput {
                    id,
                    draft: ReasoningSummaryDraft::default(),
                    complete: false,
                },
            );
            return Ok(());
        }
        let (item_id, index, text) = match event {
            ModelStreamEvent::ReasoningSummaryPartAdded {
                item_id,
                summary_index,
            } => (item_id, summary_index, None),
            ModelStreamEvent::ReasoningSummaryDelta {
                item_id,
                summary_index,
                text,
            } => (item_id, summary_index, Some(text.as_str())),
            _ => return Ok(()),
        };
        let Some(item) = self
            .summaries
            .get_mut(item_id)
            .filter(|item| !item.complete)
        else {
            return Ok(());
        };
        if let Some(text) = text.filter(|text| !text.is_empty()) {
            runner
                .emit_reasoning_summary_delta(turn_id, item.id, index, text)
                .await?;
            item.draft.append(index.clone(), text);
        } else if !item.draft.contains(index) {
            runner
                .sink
                .emit(EventPayload::ReasoningSummaryPartAdded {
                    turn_id,
                    item_id: item.id,
                    summary_index: index.clone(),
                })
                .await?;
            item.draft.add_part(index.clone());
        }
        Ok(())
    }
}
