//! Original reference promotion values, bound to the reviewed candidate and its sources.
use crate::{
    candidate_contracts::ReferenceRecordCandidatePayload,
    reference_records::{ReferenceMetadataField, ReferenceRecordDraft, ReferenceRecordPlanV1},
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReferencePromotionSourceV1 {
    pub paper_id: String,
    pub anchor_id: String,
    pub relation_kind: String,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReferencePromotionInputV1 {
    pub reference: ReferenceRecordCandidatePayload,
    pub sources: Vec<ReferencePromotionSourceV1>,
    pub provenance_kind: String,
    pub candidate_id: String,
    pub candidate_revision: i64,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReferencePromotionPlanV1 {
    pub record: ReferenceRecordPlanV1,
    pub provenance_kind: String,
    pub candidate_id: String,
    pub candidate_revision: i64,
}
impl ReferencePromotionPlanV1 {
    /// Verify the finite storage frame and source scope. Field interpretation remains Native.
    pub fn is_bound_to(&self, input: &ReferencePromotionInputV1) -> bool {
        let draft = &self.record.draft;
        self.candidate_id == input.candidate_id
            && self.candidate_revision == input.candidate_revision
            && self.provenance_kind == input.provenance_kind
            && matches!(
                self.provenance_kind.as_str(),
                "ai_accepted_unchanged" | "ai_accepted_after_edit"
            )
            && input
                .sources
                .iter()
                .find(|source| source.relation_kind == "direct_quote")
                .is_some_and(|source| {
                    source.paper_id == draft.citing_paper_id
                        && source.anchor_id == draft.source_anchor_id
                })
            && draft.id.is_none()
            && draft.expected_revision.is_none()
            && draft.raw_text == input.reference.raw_text
            && matches!(draft.parse_state.as_str(), "parsed" | "unparsed")
            && draft.fields.len() == input.reference.fields.len()
            && draft
                .fields
                .iter()
                .zip(&input.reference.fields)
                .all(|(stored, source)| stored.name == source.name && stored.value == source.value)
            && draft.identity_state == "unverified"
            && draft.matched_item_id.is_none()
            && draft.semantic_state == "unreviewed"
            && draft.usage_kind.is_none()
            && draft.usage_anchor_id.is_none()
            && draft.usage_summary.is_empty()
            && draft.change_reason == "accepted_ai_candidate"
            && self.record.raw_text == draft.raw_text.trim()
            && self.record.usage_summary.is_empty()
            && self.record.change_reason == draft.change_reason
            && serde_json::from_str::<Vec<ReferenceMetadataField>>(&self.record.fields_json)
                .is_ok_and(|fields| fields == draft.fields)
            && self.snapshot_matches(draft)
    }
    fn snapshot_matches(&self, draft: &ReferenceRecordDraft) -> bool {
        serde_json::from_str::<serde_json::Value>(&self.record.snapshot_json).is_ok_and(|snapshot| {
            snapshot == serde_json::json!({
                "record": draft,
                "acceptedFrom": {"candidateId": self.candidate_id, "candidateRevision": self.candidate_revision}
            })
        })
    }
}
