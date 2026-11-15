//! Original knowledge revision snapshots; only pure Serde data lives here.
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct KnowledgeTerm {
    pub id: String,
    pub text: String,
    pub normalized_text: String,
    pub language: String,
    pub provenance_kind: String,
    pub revision: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct KnowledgeConcept {
    pub id: String,
    pub preferred_term: KnowledgeTerm,
    pub terms: Vec<KnowledgeTerm>,
    pub label: String,
    pub explanation: String,
    pub disambiguation: String,
    pub domain: String,
    pub tradition: String,
    pub period: String,
    pub provenance_kind: String,
    pub revision: i64,
    pub definition_count: i64,
    pub source_count: i64,
    pub created_at: String,
    pub updated_at: String,
}
