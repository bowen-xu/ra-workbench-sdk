//! Finite original paper-concept item review and source-bound promotion.
use super::items::{
    AiSuggestionItemDecisionDraft, AiSuggestionResolutionDraft, SuggestionSemanticsV1,
};
use crate::{
    candidate_contracts::{
        CandidateValidationError, PaperConceptPayload, PaperConceptRelationPayload,
    },
    knowledge_promotion::KnowledgePromotionV1,
};
use serde::{Deserialize, Serialize};
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum PaperItemV1 {
    Concept(Box<PaperConceptPayload>),
    Relation(Box<PaperConceptRelationPayload>),
}
impl PaperItemV1 {
    pub fn citation_ids(&self) -> Vec<String> {
        match self {
            Self::Concept(v) => std::iter::once(v.id.clone())
                .chain(v.definition_claims.iter().map(|d| d.id.clone()))
                .collect(),
            Self::Relation(v) => vec![v.id.clone()],
        }
    }
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum PaperReviewInputV1 {
    Draft {
        draft: AiSuggestionItemDecisionDraft,
    },
    Replay {
        draft: AiSuggestionItemDecisionDraft,
        request_hash: String,
        existing: (String, String),
    },
    Candidate {
        revision: i64,
        current_revision: i64,
        review_state: String,
    },
    Select {
        payload: serde_json::Value,
        suggestion_id: String,
    },
    Action {
        draft: AiSuggestionItemDecisionDraft,
        editor_kind: String,
        item: PaperItemV1,
    },
    Inspection {
        inspected: bool,
    },
    Paper {
        paper_ids: Vec<String>,
    },
    Evidence {
        item: PaperItemV1,
    },
    Endpoints {
        concept_ids: Vec<String>,
        relation: Box<PaperConceptRelationPayload>,
        subject_id: String,
        object_id: String,
        accepted: Vec<(String, String)>,
    },
    Promotion {
        item: PaperItemV1,
        resolution: Option<AiSuggestionResolutionDraft>,
        paper_id: String,
        candidate_id: String,
        candidate_revision: i64,
        sources: Vec<(String, String)>,
    },
    State {
        total: usize,
        terminal: i64,
        accepted: i64,
        editor_kind: String,
        action: String,
    },
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum PaperReviewDecisionV1 {
    Draft {
        result: Result<String, CandidateValidationError>,
    },
    Checked {
        rejection: Option<CandidateValidationError>,
    },
    Selected {
        result: Result<Box<PaperItemV1>, CandidateValidationError>,
    },
    Action {
        result: Result<SuggestionSemanticsV1, CandidateValidationError>,
    },
    Paper {
        result: Result<String, CandidateValidationError>,
    },
    Evidence {
        evidence_ids: Vec<String>,
    },
    Promotion {
        result: Result<Box<KnowledgePromotionV1>, CandidateValidationError>,
    },
    State {
        state: String,
    },
}
impl PaperReviewInputV1 {
    pub fn matches_decision(&self, decision: &PaperReviewDecisionV1) -> bool {
        use PaperReviewDecisionV1 as D;
        match (self, decision) {
            (Self::Draft { .. }, D::Draft { result }) => result.as_ref().map_or(true, |h| {
                h.len() == 64 && h.bytes().all(|b| b.is_ascii_hexdigit())
            }),
            (
                Self::Replay { .. }
                | Self::Candidate { .. }
                | Self::Inspection { .. }
                | Self::Endpoints { .. },
                D::Checked { .. },
            ) => true,
            (
                Self::Select {
                    payload,
                    suggestion_id,
                },
                D::Selected { result },
            ) => result.as_ref().map_or(true, |item| {
                let (collection, value) = match item.as_ref() {
                    PaperItemV1::Concept(v) => ("concepts", serde_json::to_value(v)),
                    PaperItemV1::Relation(v) => ("relations", serde_json::to_value(v)),
                };
                payload["kind"] == "paper_concept_map_v1"
                    && payload[collection]
                        .as_array()
                        .and_then(|items| items.iter().find(|i| i["id"] == *suggestion_id))
                        .is_some_and(|source| value.as_ref().is_ok_and(|v| v == source))
            }),
            (Self::Action { draft, .. }, D::Action { result }) => {
                result.as_ref().map_or(true, |v| {
                    v.is_accept
                        == matches!(
                            draft.action.as_str(),
                            "accept_unchanged" | "accept_after_edit"
                        )
                        && v.resolution_kind
                            == super::items::resolution_kind(draft.resolution.as_ref())
                        && v.provenance
                            == if draft.action == "accept_after_edit" {
                                "ai_accepted_after_edit"
                            } else {
                                "ai_accepted_unchanged"
                            }
                })
            }
            (Self::Paper { paper_ids }, D::Paper { result }) => {
                result.as_ref().map_or(true, |paper| {
                    !paper_ids.is_empty() && paper_ids.iter().all(|id| id == paper)
                })
            }
            (Self::Evidence { item }, D::Evidence { evidence_ids }) => {
                evidence_ids == &paper_evidence_ids(item)
            }
            (Self::State { .. }, D::State { state }) => matches!(
                state.as_str(),
                "unreviewed"
                    | "edited"
                    | "deferred"
                    | "needs_more_evidence"
                    | "rejected"
                    | "accepted_unchanged"
                    | "accepted_after_edit"
            ),
            (
                Self::Promotion {
                    item,
                    resolution,
                    paper_id,
                    candidate_id,
                    candidate_revision,
                    sources,
                },
                D::Promotion { result },
            ) => result.as_ref().map_or(true, |plan| {
                promotion_bound(
                    item,
                    resolution.as_ref(),
                    paper_id,
                    candidate_id,
                    *candidate_revision,
                    sources,
                    plan,
                )
            }),
            _ => false,
        }
    }
}
pub fn paper_evidence_ids(item: &PaperItemV1) -> Vec<String> {
    let mut values = std::collections::BTreeSet::new();
    match item {
        PaperItemV1::Concept(v) => {
            values.extend(v.evidence_item_ids.iter().cloned());
            values.extend(
                v.surface_forms
                    .iter()
                    .flat_map(|f| f.evidence_item_ids.iter().cloned()),
            );
            values.extend(
                v.definition_claims
                    .iter()
                    .flat_map(|f| f.evidence_item_ids.iter().cloned()),
            );
            values.extend(
                v.reference_mentions
                    .iter()
                    .flat_map(|f| f.evidence_item_ids.iter().cloned()),
            );
        }
        PaperItemV1::Relation(v) => values.extend(v.evidence_item_ids.iter().cloned()),
    };
    values.into_iter().collect()
}
fn anchors(keys: &[String], sources: &[(String, String)]) -> Vec<String> {
    keys.iter()
        .filter_map(|key| {
            sources
                .iter()
                .find(|(k, _)| k == key)
                .map(|(_, a)| a.clone())
        })
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .collect()
}
fn promotion_bound(
    item: &PaperItemV1,
    resolution: Option<&AiSuggestionResolutionDraft>,
    paper_id: &str,
    candidate_id: &str,
    revision: i64,
    sources: &[(String, String)],
    plan: &KnowledgePromotionV1,
) -> bool {
    match (item, resolution, plan) {
        (PaperItemV1::Concept(c), Some(resolution), KnowledgePromotionV1::PaperConcept(p)) => {
            let resolution_matches = match (resolution, &p.resolution) {
                (
                    AiSuggestionResolutionDraft::CreateConcept,
                    crate::knowledge_promotion::AiConceptResolution::CreateNew,
                )
                | (
                    AiSuggestionResolutionDraft::Unresolved,
                    crate::knowledge_promotion::AiConceptResolution::Unresolved,
                ) => true,
                (
                    AiSuggestionResolutionDraft::LinkConcept { concept_id },
                    crate::knowledge_promotion::AiConceptResolution::LinkExisting(id),
                ) => concept_id == id,
                _ => false,
            };
            resolution_matches
                && p.paper_id == paper_id
                && p.source_candidate_id == candidate_id
                && p.source_candidate_revision == revision
                && p.source_local_concept_id == c.id
                && p.preferred_term == c.preferred_term
                && p.preferred_language
                    == c.surface_forms
                        .iter()
                        .find(|f| f.relation_kind == "preferred" && f.text == c.preferred_term)
                        .and_then(|f| f.language.clone())
                && p.anchor_ids == anchors(&c.evidence_item_ids, sources)
                && p.paper_function == c.paper_function
                && p.novelty_status == c.novelty_status
                && p.explanation_status == c.explanation_status
                && p.explanation == c.explanation
                && p.disambiguation == c.disambiguation
                && p.role_rationale == c.role_rationale
                && p.novelty_rationale == c.novelty_rationale
                && p.surface_forms.len() == c.surface_forms.len()
                && p.surface_forms.iter().zip(&c.surface_forms).all(|(p, f)| {
                    p.text == f.text
                        && p.language == f.language
                        && p.anchor_ids
                            == if f.evidence_item_ids.is_empty() {
                                anchors(&c.evidence_item_ids, sources)
                            } else {
                                anchors(&f.evidence_item_ids, sources)
                            }
                })
                && p.definition_claims.len() == c.definition_claims.len()
                && p.definition_claims
                    .iter()
                    .zip(&c.definition_claims)
                    .all(|(p, d)| {
                        p.statement == d.statement
                            && p.scope_note == d.scope_note
                            && p.anchor_ids == anchors(&d.evidence_item_ids, sources)
                    })
        }
        (
            PaperItemV1::Relation(r),
            Some(AiSuggestionResolutionDraft::AssertRelation {
                subject_concept_id,
                object_concept_id,
                project_id,
            }),
            KnowledgePromotionV1::Relation(p),
        ) => {
            p.subject_concept_id == *subject_concept_id
                && p.object_concept_id == *object_concept_id
                && p.project_id == *project_id
                && p.predicate_kind == r.predicate_kind
                && p.scope_note
                    == (!r.scope_note.trim().is_empty()).then(|| r.scope_note.trim().to_owned())
                && p.anchor_ids == anchors(&r.evidence_item_ids, sources)
        }
        _ => false,
    }
}
