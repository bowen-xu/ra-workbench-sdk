//! Finite promotion frame for original historical selection and overview reviews.
use crate::reading_units::accepted::AcceptedReadingUnitV1;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GenericPromotionInputV1 {
    pub payload: serde_json::Value,
    pub reading_unit_title: Option<String>,
    pub project_id: Option<String>,
    pub paper_id: String,
    pub anchor_ids: Vec<String>,
    pub provenance_kind: String,
    pub candidate_id: String,
    pub candidate_revision: i64,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum GenericPromotionPlanV1 {
    Portrait {
        candidate_id: String,
        candidate_revision: i64,
    },
    ReadingUnits {
        units: Vec<AcceptedReadingUnitV1>,
    },
}
impl GenericPromotionInputV1 {
    /// Bind storage scope and original field order; formatting stays with Native.
    pub fn is_bound_to(&self, plan: &GenericPromotionPlanV1) -> bool {
        match plan {
            GenericPromotionPlanV1::Portrait {
                candidate_id,
                candidate_revision,
            } => {
                self.payload["kind"] == "paper_portrait_v1"
                    && candidate_id == &self.candidate_id
                    && *candidate_revision == self.candidate_revision
            }
            GenericPromotionPlanV1::ReadingUnits { units } => {
                let kinds: Vec<&str> = match self.payload["kind"].as_str() {
                    Some("selection_explanation_v1") => vec!["other"],
                    Some("paper_overview_unit_v1") => {
                        let Some(fields) = self.payload["fields"].as_array() else {
                            return false;
                        };
                        if !self.payload["paperTemplate"].is_null() {
                            return false;
                        }
                        fields
                            .iter()
                            .filter(|field| {
                                field["statements"]
                                    .as_array()
                                    .is_some_and(|s| !s.is_empty())
                            })
                            .filter_map(|field| field["field"].as_str())
                            .collect()
                    }
                    _ => return false,
                };
                !units.is_empty()
                    && units.len() == kinds.len()
                    && units.iter().zip(kinds).all(|(unit, kind)| {
                        unit.project_id == self.project_id
                            && unit.paper_id == self.paper_id
                            && unit.unit_kind == kind
                            && unit.anchor_ids == self.anchor_ids
                            && unit.provenance_kind == self.provenance_kind
                            && unit.candidate_id == self.candidate_id
                            && unit.candidate_revision == self.candidate_revision
                    })
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::candidate_review::wire::{ReviewDecisionV1, ReviewInputV1};
    #[test]
    fn finite_generic_frames_roundtrip_and_reject_wrong_storage_scope_and_family() {
        let input = GenericPromotionInputV1 {
            payload: serde_json::json!({"kind":"selection_explanation_v1"}),
            reading_unit_title: None,
            project_id: None,
            paper_id: "paper".into(),
            anchor_ids: vec!["anchor".into()],
            provenance_kind: "ai_accepted_unchanged".into(),
            candidate_id: "candidate".into(),
            candidate_revision: 1,
        };
        let unit = AcceptedReadingUnitV1 {
            project_id: None,
            paper_id: "paper".into(),
            unit_kind: "other".into(),
            title: "Reviewed".into(),
            body: "Original".into(),
            provenance_kind: input.provenance_kind.clone(),
            epistemic_role: "source_paraphrase".into(),
            anchor_ids: input.anchor_ids.clone(),
            candidate_id: input.candidate_id.clone(),
            candidate_revision: 1,
        };
        let request = ReviewInputV1::GenericPromotion {
            input: Box::new(input.clone()),
        };
        let response = ReviewDecisionV1::GenericPromotion {
            result: Ok(Box::new(GenericPromotionPlanV1::ReadingUnits {
                units: vec![unit.clone()],
            })),
        };
        assert!(request.matches_decision(&response));
        let bytes = serde_json::to_vec(&request).unwrap();
        assert_eq!(
            serde_json::from_slice::<ReviewInputV1>(&bytes).unwrap(),
            request
        );
        let mut changed = unit.clone();
        changed.paper_id = "outside".into();
        assert!(
            !request.matches_decision(&ReviewDecisionV1::GenericPromotion {
                result: Ok(Box::new(GenericPromotionPlanV1::ReadingUnits {
                    units: vec![changed]
                }))
            })
        );
        let validation = ReviewInputV1::ReadingUnitValidation {
            ordinal: 1,
            draft: Box::new(unit),
        };
        assert!(!validation.matches_decision(&ReviewDecisionV1::Validated { rejection: None }));
        assert!(
            validation
                .matches_decision(&ReviewDecisionV1::ReadingUnitValidation { rejection: None })
        );
        assert!(!input.is_bound_to(&GenericPromotionPlanV1::Portrait {
            candidate_id: input.candidate_id.clone(),
            candidate_revision: 1
        }));
    }
}
