//! Original per-item review inputs and finite current-state observations.
use crate::candidate_contracts::{
    AttentionSuggestion, CandidateValidationError, ConceptSuggestion, DefinitionSuggestion,
    RelationSuggestion,
};
use serde::{Deserialize, Serialize};
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum AiSuggestionResolutionDraft {
    CreateConcept,
    LinkConcept {
        concept_id: String,
    },
    Unresolved,
    AttachDefinition {
        concept_id: String,
    },
    AssertRelation {
        subject_concept_id: String,
        object_concept_id: String,
        project_id: Option<String>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSuggestionItemDecisionDraft {
    pub candidate_id: String,
    pub candidate_revision: i64,
    pub suggestion_id: String,
    pub action: String,
    pub rationale: String,
    pub idempotency_key: String,
    pub resolution: Option<AiSuggestionResolutionDraft>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum SuggestionV1 {
    Concept(ConceptSuggestion),
    Definition(DefinitionSuggestion),
    Relation(RelationSuggestion),
    Attention(AttentionSuggestion),
}
impl SuggestionV1 {
    pub fn evidence_ids(&self) -> &[String] {
        match self {
            Self::Concept(v) => &v.evidence_item_ids,
            Self::Definition(v) => &v.evidence_item_ids,
            Self::Relation(v) => &v.evidence_item_ids,
            Self::Attention(v) => &v.evidence_item_ids,
        }
    }
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SuggestionSemanticsV1 {
    pub is_accept: bool,
    pub provenance: String,
    pub resolution_kind: String,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ItemReviewInputV1 {
    Promotion {
        suggestion: Box<SuggestionV1>,
        resolution: Option<AiSuggestionResolutionDraft>,
        anchor_ids: Vec<String>,
    },
    Knowledge {
        ordinal: usize,
        input: Box<crate::knowledge_promotion::KnowledgeValidationInputV1>,
    },
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
    Terminal {
        has_terminal_decision: bool,
    },
    Select {
        payload: serde_json::Value,
        suggestion_id: String,
    },
    Action {
        draft: AiSuggestionItemDecisionDraft,
        editor_kind: String,
        suggestion: Box<SuggestionV1>,
    },
    Inspection {
        inspected: bool,
    },
    Anchors {
        evidence_ids: Vec<String>,
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
pub enum ItemReviewDecisionV1 {
    Promotion {
        result:
            Result<Box<crate::knowledge_promotion::KnowledgePromotionV1>, CandidateValidationError>,
    },
    Knowledge {
        decision: crate::knowledge_promotion::KnowledgeValidationDecisionV1,
    },
    Draft {
        result: Result<String, CandidateValidationError>,
    },
    Checked {
        rejection: Option<CandidateValidationError>,
    },
    Selected {
        result: Result<Box<SuggestionV1>, CandidateValidationError>,
    },
    Action {
        result: Result<SuggestionSemanticsV1, CandidateValidationError>,
    },
    Anchors {
        result: Result<Vec<String>, CandidateValidationError>,
    },
    State {
        state: String,
    },
}
impl ItemReviewInputV1 {
    pub fn matches_decision(&self, decision: &ItemReviewDecisionV1) -> bool {
        match (self, decision) {
            (
                Self::Promotion {
                    suggestion,
                    resolution,
                    anchor_ids,
                },
                ItemReviewDecisionV1::Promotion { result },
            ) => result.as_ref().map_or(true, |plan| {
                promotion_bound(suggestion, resolution.as_ref(), anchor_ids, plan)
            }),
            (Self::Knowledge { input, .. }, ItemReviewDecisionV1::Knowledge { decision }) => {
                input.matches_decision(decision)
            }
            (Self::Draft { .. }, ItemReviewDecisionV1::Draft { result }) => {
                result.as_ref().map_or(true, |hash| {
                    hash.len() == 64 && hash.bytes().all(|byte| byte.is_ascii_hexdigit())
                })
            }
            (
                Self::Replay { .. }
                | Self::Candidate { .. }
                | Self::Terminal { .. }
                | Self::Inspection { .. },
                ItemReviewDecisionV1::Checked { .. },
            ) => true,
            (
                Self::Select {
                    payload,
                    suggestion_id,
                },
                ItemReviewDecisionV1::Selected { result },
            ) => result.as_ref().map_or(true, |suggestion| {
                suggestion.matches_source(payload, suggestion_id)
            }),
            (Self::Action { draft, .. }, ItemReviewDecisionV1::Action { result }) => {
                result.as_ref().map_or(true, |semantics| {
                    semantics.is_accept
                        == matches!(
                            draft.action.as_str(),
                            "accept_unchanged" | "accept_after_edit"
                        )
                        && semantics.provenance
                            == if draft.action == "accept_after_edit" {
                                "ai_accepted_after_edit"
                            } else {
                                "ai_accepted_unchanged"
                            }
                        && semantics.resolution_kind == resolution_kind(draft.resolution.as_ref())
                })
            }
            (
                Self::Anchors {
                    evidence_ids,
                    sources,
                },
                ItemReviewDecisionV1::Anchors { result },
            ) => result.as_ref().map_or(true, |anchors| {
                let mut expected = Vec::new();
                for key in evidence_ids {
                    if let Some((_, anchor)) =
                        sources.iter().find(|(candidate, _)| candidate == key)
                        && !expected.contains(anchor)
                    {
                        expected.push(anchor.clone());
                    }
                }
                !anchors.is_empty() && anchors == &expected
            }),
            (Self::State { .. }, ItemReviewDecisionV1::State { state }) => {
                matches!(
                    state.as_str(),
                    "accepted_unchanged"
                        | "accepted_after_edit"
                        | "rejected"
                        | "deferred"
                        | "needs_more_evidence"
                        | "edited"
                        | "unreviewed"
                )
            }
            _ => false,
        }
    }
}
impl SuggestionV1 {
    fn matches_source(&self, payload: &serde_json::Value, id: &str) -> bool {
        let Some(source) = payload["suggestions"]
            .as_array()
            .and_then(|items| items.iter().find(|item| item["id"] == id))
        else {
            return false;
        };
        let (kind, value) = match self {
            Self::Concept(value) => ("concept_suggestion_v1", serde_json::to_value(value)),
            Self::Definition(value) => ("definition_suggestion_v1", serde_json::to_value(value)),
            Self::Relation(value) => ("relation_suggestion_v1", serde_json::to_value(value)),
            Self::Attention(value) => ("attention_suggestion_v1", serde_json::to_value(value)),
        };
        payload["kind"] == kind && value.as_ref().is_ok_and(|value| value == source)
    }
}
pub fn resolution_kind(resolution: Option<&AiSuggestionResolutionDraft>) -> &'static str {
    match resolution {
        None => "none",
        Some(AiSuggestionResolutionDraft::CreateConcept) => "create_concept",
        Some(AiSuggestionResolutionDraft::LinkConcept { .. }) => "link_concept",
        Some(AiSuggestionResolutionDraft::Unresolved) => "unresolved",
        Some(AiSuggestionResolutionDraft::AttachDefinition { .. }) => "attach_definition",
        Some(AiSuggestionResolutionDraft::AssertRelation { .. }) => "assert_relation",
    }
}

fn promotion_bound(
    suggestion: &SuggestionV1,
    resolution: Option<&AiSuggestionResolutionDraft>,
    anchor_ids: &[String],
    plan: &crate::knowledge_promotion::KnowledgePromotionV1,
) -> bool {
    use crate::knowledge_promotion::{
        AiConceptResolution as Resolution, KnowledgePromotionV1 as Plan,
    };
    match (suggestion, resolution, plan) {
        (SuggestionV1::Concept(source), Some(resolution), Plan::Concept(draft)) => {
            let bound = match (resolution, &draft.resolution) {
                (AiSuggestionResolutionDraft::CreateConcept, Resolution::CreateNew)
                | (AiSuggestionResolutionDraft::Unresolved, Resolution::Unresolved) => true,
                (
                    AiSuggestionResolutionDraft::LinkConcept { concept_id },
                    Resolution::LinkExisting(actual),
                ) => concept_id == actual,
                _ => false,
            };
            bound
                && draft.anchor_ids == anchor_ids
                && draft.term == source.term
                && draft.language == source.language
                && draft.explanation == source.explanation
                && draft.disambiguation == source.disambiguation
                && draft.domain == source.domain
                && draft.tradition == source.tradition
                && draft.period == source.period
        }
        (
            SuggestionV1::Definition(source),
            Some(AiSuggestionResolutionDraft::AttachDefinition { concept_id }),
            Plan::Definition(draft),
        ) => {
            draft.concept_id == *concept_id
                && draft.statement == source.statement
                && draft.scope_note == source.scope_note
                && draft.anchor_ids == anchor_ids
        }
        (
            SuggestionV1::Relation(source),
            Some(AiSuggestionResolutionDraft::AssertRelation {
                subject_concept_id,
                object_concept_id,
                project_id,
            }),
            Plan::Relation(draft),
        ) => {
            draft.subject_concept_id == *subject_concept_id
                && draft.object_concept_id == *object_concept_id
                && draft.project_id == *project_id
                && draft.predicate_kind == source.predicate_kind
                && draft.scope_note == source.scope_note
                && draft.anchor_ids == anchor_ids
        }
        _ => false,
    }
}

#[cfg(test)]
mod tests;
