//! Shared original candidate DTOs and pure validation failures; no App or I/O.
use serde::{Deserialize, Serialize};
mod payloads;
mod template;
mod template_wire;
pub use payloads::{
    AtomicStatement, AttentionSuggestion, AttentionSuggestionPayload, CandidatePayload,
    CitationReference, ConceptSuggestion, ConceptSuggestionPayload, CustomDimension,
    DefinitionSuggestion, DefinitionSuggestionPayload, DerivedResearchViewCandidateItem,
    DerivedResearchViewCandidatePayload, PaperConceptMapPayload, PaperConceptOmissionPayload,
    PaperConceptPayload, PaperConceptRelationPayload, PaperConceptSurfaceFormPayload,
    PaperDefinitionPayload, PaperOverviewField, PaperOverviewPayload, PaperPortraitPayload,
    PaperReferenceMentionPayload, PortraitClaim, PortraitEvidence, ReferenceFieldCandidate,
    ReferenceRecordCandidatePayload, RelationSuggestion, RelationSuggestionPayload,
    SelectionExplanationPayload, TemplateField,
};
pub use template::{
    AiOverviewProfileContext, AiReadingProfileRef, PaperTemplateRef, PaperTemplateSnapshot,
};
pub use template_wire::{template_field_identity, valid_template_color, valid_template_snapshot};

pub const GENERIC_OVERVIEW_FIELDS: [&str; 6] = [
    "research_question",
    "approach",
    "key_result",
    "conclusion",
    "limitation",
    "open_question",
];

pub const OVERVIEW_FIELDS: [&str; 9] = [
    "research_question",
    "approach",
    "key_result",
    "conclusion",
    "limitation",
    "open_question",
    "argument",
    "objection",
    "response",
];

pub const RELATION_PREDICATE_KINDS: [&str; 16] = [
    "broader_than",
    "narrower_than",
    "competes_with",
    "historically_derived_from",
    "approximately_corresponds_to",
    "defines",
    "discusses",
    "supports",
    "opposes",
    "related_to",
    "depends_on",
    "builds_on",
    "extends",
    "redefines",
    "contrasts_with",
    "part_of",
];

/// Only the original pure decoder/quote failures, without App or SQL owners.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, thiserror::Error)]
#[serde(
    tag = "kind",
    content = "detail",
    rename_all = "camelCase",
    deny_unknown_fields
)]
pub enum CandidateValidationError {
    #[error("{0}")]
    InvalidInput(String),
    #[error("{path}: {message}")]
    Validation { path: String, message: String },
}

/// Preserve all original entries: equal citation keys may hold different quotes.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EvidenceQuote {
    pub citation_key: String,
    pub quote_exact: String,
}

#[cfg(test)]
mod tests;
