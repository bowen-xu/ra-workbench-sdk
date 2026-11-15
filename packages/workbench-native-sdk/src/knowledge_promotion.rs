//! Original owned knowledge-acceptance drafts and finite original write-boundary checks.
pub mod algorithms;
pub mod capture;
pub mod foundations;
pub mod identity;
pub mod manual;
pub mod models;
pub mod paper;
pub mod relation;
use crate::concepts::{ConceptTermPlanV1, NewConceptDetails};
use serde::{Deserialize, Serialize};
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AiConceptResolution {
    CreateNew,
    LinkExisting(String),
    Unresolved,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConceptPromotion {
    pub term: String,
    pub language: Option<String>,
    pub explanation: String,
    pub disambiguation: Option<String>,
    pub domain: Option<String>,
    pub tradition: Option<String>,
    pub period: Option<String>,
    pub resolution: AiConceptResolution,
    pub anchor_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiDefinitionPromotion {
    pub concept_id: String,
    pub statement: String,
    pub scope_note: Option<String>,
    pub anchor_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiRelationPromotion {
    pub project_id: Option<String>,
    pub subject_concept_id: String,
    pub predicate_kind: String,
    pub object_concept_id: String,
    pub scope_note: Option<String>,
    pub anchor_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum KnowledgePromotionV1 {
    PaperConcept(paper::AiPaperConceptPromotion),
    Concept(AiConceptPromotion),
    Definition(AiDefinitionPromotion),
    Relation(AiRelationPromotion),
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum KnowledgeValidationInputV1 {
    FoundationScope {
        invalid_id: bool,
        unique_papers: usize,
    },
    FoundationComparison {
        input: Box<foundations::FoundationInputV1>,
    },
    AlgorithmId {
        purpose: algorithms::AlgorithmIdKindV1,
        is_empty: bool,
        bytes: usize,
    },
    EvolutionEvents {
        snapshot_sha256: [u8; 32],
        novelty_statuses: Vec<Option<String>>,
    },
    IdentityMergeRationale {
        characters: usize,
    },
    IdentityMergeShape {
        source_count: usize,
        survivor_is_empty: bool,
        duplicate_sources: bool,
        includes_survivor: bool,
    },
    IdentitySplitShape {
        source_count: usize,
        rationale_characters: usize,
        duplicate_sources: bool,
    },
    IdentityTarget {
        snapshot_sha256: [u8; 32],
        mapped: bool,
        has_children: bool,
    },
    IdentitySnapshot {
        snapshot_sha256: [u8; 32],
    },
    IdentitySplitEvent {
        snapshot_sha256: [u8; 32],
        is_merge: bool,
        selected_are_active: bool,
    },
    IdentityMappingDeleted {
        changed: usize,
    },
    RelationDraft {
        facts: Box<relation::RelationDraftFactsV1>,
    },
    RelationNode {
        node_kind: String,
        id_is_empty: bool,
        id_bytes: usize,
    },
    RelationEndpoints {
        same: bool,
        subject_sha256: [u8; 32],
        object_sha256: [u8; 32],
    },
    RelationRevision {
        current_revision: Option<i64>,
        expected_revision: Option<i64>,
        current_sha256: Option<[u8; 32]>,
    },
    RelationSearch {
        query_characters: usize,
    },
    ManualDefinition {
        concept_identity_sha256: [u8; 32],
        statement_is_empty: bool,
    },
    DefinitionRevision {
        expected_revision: Option<i64>,
        current_revision: Option<i64>,
    },
    RevisionKind {
        object_kind: String,
    },
    Capture {
        draft: Box<capture::ConceptCaptureDraft>,
        quote: String,
    },
    PaperConcept {
        draft: Box<paper::AiPaperConceptPromotion>,
    },
    Origin {
        provenance_kind: String,
        anchor_ids: Vec<String>,
    },
    UniqueAnchor {
        duplicate: bool,
    },
    Term {
        text: String,
        language: String,
    },
    Details {
        details: NewConceptDetails,
    },
    NameCollision {
        collision: bool,
    },
    Definition {
        statement: String,
        scope_note: String,
    },
    Predicate {
        predicate_kind: String,
    },
    DifferentConcepts {
        same: bool,
    },
    Node {
        id: String,
    },
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum KnowledgeValidationDecisionV1 {
    FoundationComparison {
        result: Result<String, String>,
    },
    EvolutionEvents {
        result: Result<Vec<algorithms::EvolutionEventKindV1>, String>,
    },
    RelationNode {
        result: Result<relation::RelationNodeKindV1, String>,
    },
    RelationRevision {
        rejection: Option<relation::RelationRevisionRejectionV1>,
    },
    RelationSearch {
        result: Result<relation::RelationSearchPlanV1, String>,
    },
    DefinitionRevision {
        rejection: Option<manual::DefinitionRevisionRejectionV1>,
    },
    Capture {
        prepared: Box<capture::ConceptCapturePlanV1>,
    },
    PaperConcept {
        result: Result<Box<paper::PaperConceptPreparationV1>, String>,
    },
    Checked {
        rejection: Option<String>,
    },
    Term {
        prepared: ConceptTermPlanV1,
    },
    Details {
        result: Result<(NewConceptDetails, String), String>,
    },
    Definition {
        result: Result<(String, String), String>,
    },
}
impl KnowledgeValidationInputV1 {
    pub fn matches_decision(&self, decision: &KnowledgeValidationDecisionV1) -> bool {
        if let (
            Self::RelationNode { node_kind, .. },
            KnowledgeValidationDecisionV1::RelationNode {
                result: Ok(prepared),
            },
        ) = (self, decision)
        {
            return node_kind == prepared.as_str();
        }
        if let (
            Self::RelationRevision {
                current_revision, ..
            },
            KnowledgeValidationDecisionV1::RelationRevision {
                rejection:
                    Some(relation::RelationRevisionRejectionV1::Conflict {
                        current_revision: reported,
                    }),
            },
        ) = (self, decision)
        {
            return *current_revision == Some(*reported);
        }
        if let (
            Self::PaperConcept { draft },
            KnowledgeValidationDecisionV1::PaperConcept { result },
        ) = (self, decision)
        {
            return result
                .as_ref()
                .map_or(true, |prepared| prepared.matches_source(draft));
        }
        if let (
            Self::FoundationComparison { .. },
            KnowledgeValidationDecisionV1::FoundationComparison { result },
        ) = (self, decision)
        {
            return result.as_ref().map_or(true, |encoded| {
                crate::paper_context_wire::decode_payload::<
                    Result<
                        Vec<algorithms::PaperFoundationSimilarity>,
                        foundations::FoundationRejectionV1,
                    >,
                >(encoded)
                .is_ok()
            });
        }
        matches!(
            (self, decision),
            (Self::EvolutionEvents { novelty_statuses, .. }, KnowledgeValidationDecisionV1::EvolutionEvents { result }) if (result.is_err() || result.as_ref().is_ok_and(|kinds| kinds.len() == novelty_statuses.len()))
        ) || matches!(
            (self, decision),
            (
                Self::RelationNode { .. },
                KnowledgeValidationDecisionV1::RelationNode { .. }
            ) | (
                Self::RelationRevision { .. },
                KnowledgeValidationDecisionV1::RelationRevision { .. }
            ) | (
                Self::RelationSearch { .. },
                KnowledgeValidationDecisionV1::RelationSearch { .. }
            ) | (
                Self::DefinitionRevision { .. },
                KnowledgeValidationDecisionV1::DefinitionRevision { .. }
            ) | (
                Self::Capture { .. },
                KnowledgeValidationDecisionV1::Capture { .. }
            ) | (
                Self::Term { .. },
                KnowledgeValidationDecisionV1::Term { .. }
            ) | (
                Self::Details { .. },
                KnowledgeValidationDecisionV1::Details { .. }
            ) | (
                Self::Definition { .. },
                KnowledgeValidationDecisionV1::Definition { .. }
            ) | (
                Self::FoundationScope { .. }
                    | Self::AlgorithmId { .. }
                    | Self::IdentityMergeRationale { .. }
                    | Self::IdentityMergeShape { .. }
                    | Self::IdentitySplitShape { .. }
                    | Self::IdentityTarget { .. }
                    | Self::IdentitySnapshot { .. }
                    | Self::IdentitySplitEvent { .. }
                    | Self::IdentityMappingDeleted { .. }
                    | Self::RelationDraft { .. }
                    | Self::RelationEndpoints { .. }
                    | Self::ManualDefinition { .. }
                    | Self::RevisionKind { .. }
                    | Self::Origin { .. }
                    | Self::UniqueAnchor { .. }
                    | Self::NameCollision { .. }
                    | Self::Predicate { .. }
                    | Self::DifferentConcepts { .. }
                    | Self::Node { .. },
                KnowledgeValidationDecisionV1::Checked { .. },
            )
        )
    }
}
