//! Finite original generic-review decisions over bounded current observations.
use super::contracts::{AiReviewDecisionDraft, GenericCandidateObservation};
use crate::candidate_contracts::CandidateValidationError;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ReviewInputV1 {
    GenericPromotion {
        input: Box<super::generic::GenericPromotionInputV1>,
    },
    ReadingUnitValidation {
        ordinal: usize,
        draft: Box<crate::reading_units::accepted::AcceptedReadingUnitV1>,
    },
    DerivedPromotion {
        input: Box<super::derived::DerivedPromotionInputV1>,
    },
    DerivedValidation {
        input: Box<crate::derived_view::DerivedValidationInputV1>,
    },
    ReferencePromotion {
        input: Box<super::reference::ReferencePromotionInputV1>,
    },
    ValidateDraft {
        draft: AiReviewDecisionDraft,
    },
    Replay {
        draft: AiReviewDecisionDraft,
        existing: (String, i64, String, String),
    },
    Candidate {
        draft: AiReviewDecisionDraft,
        observation: GenericCandidateObservation,
    },
    Inspection {
        inspected: bool,
    },
    ProjectMembership {
        contains: bool,
    },
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ReviewDecisionV1 {
    GenericPromotion {
        result: Result<Box<super::generic::GenericPromotionPlanV1>, CandidateValidationError>,
    },
    ReadingUnitValidation {
        rejection: Option<CandidateValidationError>,
    },
    DerivedPromotion {
        result: Result<Box<crate::derived_view::AcceptedDerivedViewV1>, CandidateValidationError>,
    },
    DerivedValidation {
        rejection: Option<CandidateValidationError>,
    },
    ReferencePromotion {
        result: Result<Box<super::reference::ReferencePromotionPlanV1>, CandidateValidationError>,
    },
    Validated {
        rejection: Option<CandidateValidationError>,
    },
    Candidate {
        result: Result<GenericReviewSemanticsV1, CandidateValidationError>,
    },
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GenericReviewSemanticsV1 {
    pub review_state: String,
    pub provenance: Option<String>,
    pub requires_inspection: bool,
    pub requires_citations: bool,
}
impl ReviewInputV1 {
    pub fn matches_decision(&self, decision: &ReviewDecisionV1) -> bool {
        if let (Self::GenericPromotion { input }, ReviewDecisionV1::GenericPromotion { result }) =
            (self, decision)
        {
            return result.as_ref().is_ok_and(|plan| input.is_bound_to(plan)) || result.is_err();
        }
        if let (
            Self::ReadingUnitValidation { .. },
            ReviewDecisionV1::ReadingUnitValidation { .. },
        ) = (self, decision)
        {
            return true;
        }
        if let (Self::DerivedPromotion { input }, ReviewDecisionV1::DerivedPromotion { result }) =
            (self, decision)
        {
            return result.as_ref().is_ok_and(|plan| input.is_bound_to(plan)) || result.is_err();
        }
        if let (Self::DerivedValidation { .. }, ReviewDecisionV1::DerivedValidation { .. }) =
            (self, decision)
        {
            return true;
        }
        if let (Self::Candidate { .. }, ReviewDecisionV1::Candidate { result }) = (self, decision) {
            return result.as_ref().is_ok_and(|semantics| {
                matches!(
                    (
                        semantics.review_state.as_str(),
                        semantics.provenance.as_deref()
                    ),
                    ("accepted_unchanged", Some("ai_accepted_unchanged"))
                        | ("accepted_after_edit", Some("ai_accepted_after_edit"))
                        | ("rejected" | "deferred" | "needs_more_evidence", None)
                )
            }) || result.is_err();
        }
        if let (
            Self::ReferencePromotion { input },
            ReviewDecisionV1::ReferencePromotion { result },
        ) = (self, decision)
        {
            return result.as_ref().is_ok_and(|plan| plan.is_bound_to(input)) || result.is_err();
        }
        matches!(
            (self, decision),
            (Self::Candidate { .. }, ReviewDecisionV1::Candidate { .. })
                | (
                    Self::ValidateDraft { .. }
                        | Self::Replay { .. }
                        | Self::Inspection { .. }
                        | Self::ProjectMembership { .. },
                    ReviewDecisionV1::Validated { .. }
                )
        )
    }
}
