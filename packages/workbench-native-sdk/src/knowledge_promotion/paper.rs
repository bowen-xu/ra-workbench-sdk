//! Original owned paper-concept acceptance drafts and finite preparation.
use super::{AiConceptPromotion, AiConceptResolution};
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiPaperSurfaceFormPromotion {
    pub text: String,
    pub language: Option<String>,
    pub anchor_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiPaperDefinitionPromotion {
    pub statement: String,
    pub scope_note: String,
    pub anchor_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiPaperConceptPromotion {
    pub paper_id: String,
    pub source_candidate_id: String,
    pub source_candidate_revision: i64,
    pub source_local_concept_id: String,
    pub preferred_term: String,
    pub preferred_language: Option<String>,
    pub surface_forms: Vec<AiPaperSurfaceFormPromotion>,
    pub paper_function: String,
    pub novelty_status: String,
    pub explanation_status: String,
    pub explanation: String,
    pub disambiguation: String,
    pub role_rationale: String,
    pub novelty_rationale: String,
    pub definition_claims: Vec<AiPaperDefinitionPromotion>,
    pub anchor_ids: Vec<String>,
    pub resolution: AiConceptResolution,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PaperConceptPreparationV1 {
    pub base: AiConceptPromotion,
    pub surface_forms: Vec<AiPaperSurfaceFormPromotion>,
    pub definition_claims: Vec<AiPaperDefinitionPromotion>,
}
impl PaperConceptPreparationV1 {
    pub fn matches_source(&self, draft: &AiPaperConceptPromotion) -> bool {
        self.base.term == draft.preferred_term
            && self.base.language == draft.preferred_language
            && self.base.explanation == draft.explanation
            && self.base.disambiguation
                == (!draft.disambiguation.trim().is_empty())
                    .then(|| draft.disambiguation.trim().to_owned())
            && self.base.domain.is_none()
            && self.base.tradition.is_none()
            && self.base.period.is_none()
            && self.base.resolution == draft.resolution
            && self.base.anchor_ids == draft.anchor_ids
            && self.surface_forms
                == draft
                    .surface_forms
                    .iter()
                    .filter(|form| {
                        !(form.text == draft.preferred_term
                            && form.language == draft.preferred_language)
                    })
                    .cloned()
                    .collect::<Vec<_>>()
            && self.definition_claims == draft.definition_claims
    }
}
