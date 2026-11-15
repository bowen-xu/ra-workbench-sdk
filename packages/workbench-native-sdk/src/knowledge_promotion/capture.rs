//! Original human source-capture codecs and finite preparation result.
use super::models::{DefinitionClaim, TermUsage};
use crate::concepts::{Concept, NewConceptDetails, Term};
use serde::{Deserialize, Serialize};
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum ConceptResolutionDraft {
    CreateNew {
        concept: NewConceptDetails,
        definition_statement: Option<String>,
    },
    LinkExisting {
        concept_id: String,
        definition_statement: Option<String>,
    },
    Unresolved,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConceptCaptureDraft {
    pub term_text: String,
    pub language: Option<String>,
    pub anchor_id: String,
    pub usage_text: String,
    pub resolution: ConceptResolutionDraft,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConceptCaptureResult {
    pub term: Term,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub concept: Option<Concept>,
    pub usage: TermUsage,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub definition_claim: Option<DefinitionClaim>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConceptCapturePlanV1 {
    pub usage_text: String,
    pub resolution: ConceptResolutionDraft,
}
