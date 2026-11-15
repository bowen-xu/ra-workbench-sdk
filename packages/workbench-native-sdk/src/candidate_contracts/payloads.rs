//! Original candidate payload DTOs, with unchanged Serde and field order.
use super::{AiReadingProfileRef, PaperTemplateSnapshot};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(untagged)]
pub enum CandidatePayload {
    PaperPortrait(PaperPortraitPayload),
    Selection(SelectionExplanationPayload),
    PaperOverview(PaperOverviewPayload),
    PaperConceptMap(PaperConceptMapPayload),
    ConceptSuggestion(ConceptSuggestionPayload),
    DefinitionSuggestion(DefinitionSuggestionPayload),
    RelationSuggestion(RelationSuggestionPayload),
    AttentionSuggestion(AttentionSuggestionPayload),
    ReferenceRecord(ReferenceRecordCandidatePayload),
    DerivedResearchView(DerivedResearchViewCandidatePayload),
}

impl CandidatePayload {
    pub fn kind(&self) -> &'static str {
        match self {
            Self::PaperPortrait(_) => "paper_portrait_v1",
            Self::Selection(_) => "selection_explanation_v1",
            Self::PaperOverview(_) => "paper_overview_unit_v1",
            Self::PaperConceptMap(_) => "paper_concept_map_v1",
            Self::ConceptSuggestion(_) => "concept_suggestion_v1",
            Self::DefinitionSuggestion(_) => "definition_suggestion_v1",
            Self::RelationSuggestion(_) => "relation_suggestion_v1",
            Self::AttentionSuggestion(_) => "attention_suggestion_v1",
            Self::ReferenceRecord(_) => "reference_record_candidate_v1",
            Self::DerivedResearchView(_) => "derived_research_view_v1",
        }
    }

    pub fn citation_references(&self) -> Vec<CitationReference<'_>> {
        match self {
            Self::PaperPortrait(payload) => payload
                .claims
                .iter()
                .flat_map(|claim| {
                    claim
                        .evidence
                        .iter()
                        .enumerate()
                        .map(|(index, source)| CitationReference {
                            statement_id: format!("{}:e{index}", claim.id),
                            evidence_item_ids: std::slice::from_ref(&source.evidence_item_id),
                        })
                })
                .collect(),
            Self::Selection(payload) => payload
                .statements
                .iter()
                .map(|item| CitationReference::new(&item.id, &item.evidence_item_ids))
                .collect(),
            Self::PaperOverview(payload) => payload
                .fields
                .iter()
                .flat_map(|field| field.statements.iter())
                .map(|item| CitationReference::new(&item.id, &item.evidence_item_ids))
                .collect(),
            Self::PaperConceptMap(payload) => {
                let mut references = Vec::new();
                for concept in &payload.concepts {
                    references.push(CitationReference::new(
                        &concept.id,
                        &concept.evidence_item_ids,
                    ));
                    references.extend(concept.definition_claims.iter().map(|definition| {
                        CitationReference::new(&definition.id, &definition.evidence_item_ids)
                    }));
                }
                references.extend(payload.relations.iter().map(|relation| {
                    CitationReference::new(&relation.id, &relation.evidence_item_ids)
                }));
                references
            }
            Self::ConceptSuggestion(payload) => payload
                .suggestions
                .iter()
                .map(|item| CitationReference::new(&item.id, &item.evidence_item_ids))
                .collect(),
            Self::DefinitionSuggestion(payload) => payload
                .suggestions
                .iter()
                .map(|item| CitationReference::new(&item.id, &item.evidence_item_ids))
                .collect(),
            Self::RelationSuggestion(payload) => payload
                .suggestions
                .iter()
                .map(|item| CitationReference::new(&item.id, &item.evidence_item_ids))
                .collect(),
            Self::AttentionSuggestion(payload) => payload
                .suggestions
                .iter()
                .map(|item| CitationReference::new(&item.id, &item.evidence_item_ids))
                .collect(),
            Self::ReferenceRecord(payload) => {
                let mut references = vec![CitationReference::new(
                    "reference-record",
                    &payload.evidence_item_ids,
                )];
                references.extend(payload.fields.iter().map(|field| CitationReference {
                    statement_id: format!("reference-field:{}", field.name),
                    evidence_item_ids: &field.evidence_item_ids,
                }));
                references
            }
            Self::DerivedResearchView(payload) => payload
                .items
                .iter()
                .map(|item| CitationReference::new(&item.id, &item.evidence_item_ids))
                .collect(),
        }
    }
}

pub struct CitationReference<'a> {
    pub statement_id: String,
    pub evidence_item_ids: &'a [String],
}

impl<'a> CitationReference<'a> {
    fn new(statement_id: &str, evidence_item_ids: &'a [String]) -> Self {
        Self {
            statement_id: statement_id.to_owned(),
            evidence_item_ids,
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SelectionExplanationPayload {
    pub kind: String,
    pub schema_version: i64,
    pub statements: Vec<AtomicStatement>,
    pub uncertainties: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PaperOverviewPayload {
    pub kind: String,
    pub schema_version: i64,
    pub profile_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile_refs: Option<Vec<AiReadingProfileRef>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub paper_template: Option<PaperTemplateSnapshot>,
    pub fields: Vec<PaperOverviewField>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PaperOverviewField {
    pub field: String,
    pub status: String,
    pub statements: Vec<AtomicStatement>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AtomicStatement {
    pub id: String,
    pub text: String,
    pub epistemic_role: String,
    pub evidence_item_ids: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub evidence_quotes: Option<Vec<PortraitEvidence>>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PaperPortraitPayload {
    pub kind: String,
    pub schema_version: i64,
    pub coverage: String,
    pub claims: Vec<PortraitClaim>,
    pub template: Vec<TemplateField>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub custom_dimensions: Vec<CustomDimension>,
}
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CustomDimension {
    pub id: String,
    pub title: String,
    pub description: String,
}
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PortraitClaim {
    pub id: String,
    pub dimension: String,
    pub label: String,
    pub description: String,
    pub certainty: String,
    pub evidence: Vec<PortraitEvidence>,
}
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PortraitEvidence {
    pub evidence_item_id: String,
    pub quote: String,
}
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TemplateField {
    pub id: String,
    pub title: String,
    pub question: String,
    pub claim_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PaperConceptMapPayload {
    pub kind: String,
    pub schema_version: i64,
    pub concepts: Vec<PaperConceptPayload>,
    pub relations: Vec<PaperConceptRelationPayload>,
    pub omissions: Vec<PaperConceptOmissionPayload>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PaperConceptPayload {
    pub id: String,
    pub preferred_term: String,
    pub surface_forms: Vec<PaperConceptSurfaceFormPayload>,
    pub paper_function: String,
    pub novelty_status: String,
    pub explanation_status: String,
    pub explanation: String,
    pub disambiguation: String,
    pub role_rationale: String,
    pub novelty_rationale: String,
    pub definition_claims: Vec<PaperDefinitionPayload>,
    pub evidence_item_ids: Vec<String>,
    pub reference_mentions: Vec<PaperReferenceMentionPayload>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PaperConceptSurfaceFormPayload {
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    pub relation_kind: String,
    pub evidence_item_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PaperDefinitionPayload {
    pub id: String,
    pub statement: String,
    pub scope_note: String,
    pub evidence_item_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PaperReferenceMentionPayload {
    pub citation_text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cited_key: Option<String>,
    pub evidence_item_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PaperConceptRelationPayload {
    pub id: String,
    pub subject_concept_candidate_id: String,
    pub predicate_kind: String,
    pub object_concept_candidate_id: String,
    pub scope_note: String,
    pub evidence_item_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PaperConceptOmissionPayload {
    pub term: String,
    pub reason: String,
    pub evidence_item_ids: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConceptSuggestionPayload {
    pub kind: String,
    pub schema_version: i64,
    pub suggestions: Vec<ConceptSuggestion>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DefinitionSuggestionPayload {
    pub kind: String,
    pub schema_version: i64,
    pub suggestions: Vec<DefinitionSuggestion>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RelationSuggestionPayload {
    pub kind: String,
    pub schema_version: i64,
    pub suggestions: Vec<RelationSuggestion>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AttentionSuggestionPayload {
    pub kind: String,
    pub schema_version: i64,
    pub suggestions: Vec<AttentionSuggestion>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConceptSuggestion {
    pub id: String,
    pub term: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    pub explanation: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub disambiguation: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub domain: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tradition: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub period: Option<String>,
    pub epistemic_role: String,
    pub evidence_item_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DefinitionSuggestion {
    pub id: String,
    pub term: String,
    pub statement: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scope_note: Option<String>,
    pub epistemic_role: String,
    pub evidence_item_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RelationSuggestion {
    pub id: String,
    pub subject_term: String,
    pub predicate_kind: String,
    pub object_term: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scope_note: Option<String>,
    pub epistemic_role: String,
    pub evidence_item_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AttentionSuggestion {
    pub id: String,
    pub title: String,
    pub reason: String,
    pub priority: String,
    pub evidence_item_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReferenceRecordCandidatePayload {
    pub kind: String,
    pub schema_version: i64,
    pub raw_text: String,
    pub evidence_item_ids: Vec<String>,
    pub fields: Vec<ReferenceFieldCandidate>,
    pub uncertainties: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReferenceFieldCandidate {
    pub name: String,
    pub value: String,
    pub evidence_item_ids: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DerivedResearchViewCandidatePayload {
    pub kind: String,
    pub schema_version: i64,
    pub view_kind: String,
    pub title: String,
    pub scope_note: String,
    pub items: Vec<DerivedResearchViewCandidateItem>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DerivedResearchViewCandidateItem {
    pub id: String,
    pub text: String,
    pub epistemic_role: String,
    pub evidence_item_ids: Vec<String>,
    pub has_conflict: bool,
}
