//! Original derived-view promotion frame bound to its frozen matrix and candidate.
use crate::{
    candidate_contracts::DerivedResearchViewCandidatePayload, derived_view::AcceptedDerivedViewV1,
    generation::AiMatrixSynthesisContext,
};
use serde::{Deserialize, Serialize};
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DerivedPromotionInputV1 {
    pub view: DerivedResearchViewCandidatePayload,
    pub context: Option<AiMatrixSynthesisContext>,
    pub project_id: Option<String>,
    pub anchors_by_key: Vec<(String, String)>,
    pub provenance_kind: String,
    pub provider_id: String,
    pub model_id: String,
    pub generated_at: String,
    pub candidate_id: String,
    pub candidate_revision: i64,
}
impl DerivedPromotionInputV1 {
    pub fn is_bound_to(&self, plan: &AcceptedDerivedViewV1) -> bool {
        self.context.as_ref().is_some_and(|context| {
            plan.project_id == context.project_id && plan.inputs == context.inputs
        }) && plan.view_kind == self.view.view_kind
            && plan.title == self.view.title
            && plan.scope_note == self.view.scope_note
            && plan.provider_id == self.provider_id
            && plan.model_id == self.model_id
            && plan.generated_at == self.generated_at
            && plan.candidate_id == self.candidate_id
            && plan.candidate_revision == self.candidate_revision
            && plan.provenance_kind
                == if self.provenance_kind == "ai_accepted_after_edit" {
                    "ai_accepted_after_edit"
                } else {
                    "ai_suggestion"
                }
            && plan.items.len() == self.view.items.len()
            && plan
                .items
                .iter()
                .zip(&self.view.items)
                .all(|(stored, original)| {
                    stored.id == original.id
                        && stored.text == original.text
                        && stored.epistemic_role == original.epistemic_role
                        && stored.has_conflict == original.has_conflict
                        && stored.evidence_anchor_ids.len() == original.evidence_item_ids.len()
                        && stored
                            .evidence_anchor_ids
                            .iter()
                            .zip(&original.evidence_item_ids)
                            .all(|(anchor, key)| {
                                self.anchors_by_key
                                    .iter()
                                    .rev()
                                    .find(|(candidate, _)| candidate == key)
                                    .is_some_and(|(_, bound)| bound == anchor)
                            })
                })
    }
}
