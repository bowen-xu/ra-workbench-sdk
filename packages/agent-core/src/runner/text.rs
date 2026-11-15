//! Emit bounded UTF-8 event deltas under the existing runner sink owner.
use super::*;
impl TurnRunner<'_> {
    pub(super) async fn emit_reasoning_summary_delta(
        &self,
        turn_id: Uuid,
        item_id: Uuid,
        index: &crate::protocol::ReasoningSummaryIndex,
        text: &str,
    ) -> Result<(), RunError> {
        let mut start = 0;
        for (count, (end, _)) in text.char_indices().enumerate() {
            if count > 0 && count % 65_536 == 0 {
                self.sink
                    .emit(EventPayload::ReasoningSummaryDelta {
                        turn_id,
                        item_id,
                        summary_index: index.clone(),
                        text: text[start..end].into(),
                    })
                    .await?;
                start = end;
            }
        }
        if start < text.len() {
            self.sink
                .emit(EventPayload::ReasoningSummaryDelta {
                    turn_id,
                    item_id,
                    summary_index: index.clone(),
                    text: text[start..].into(),
                })
                .await?;
        }
        Ok(())
    }
    pub(super) async fn emit_text(
        &self,
        turn_id: Uuid,
        item_id: Uuid,
        text: &str,
    ) -> Result<(), RunError> {
        // Match the wire delta bound without splitting a UTF-8 scalar value.
        let mut start = 0;
        for (count, (index, _)) in text.char_indices().enumerate() {
            if count > 0 && count % 65_536 == 0 {
                self.sink
                    .emit(EventPayload::TextDelta {
                        turn_id,
                        item_id,
                        text: text[start..index].into(),
                    })
                    .await?;
                start = index;
            }
        }
        if start < text.len() {
            self.sink
                .emit(EventPayload::TextDelta {
                    turn_id,
                    item_id,
                    text: text[start..].into(),
                })
                .await?;
        }
        Ok(())
    }
}
