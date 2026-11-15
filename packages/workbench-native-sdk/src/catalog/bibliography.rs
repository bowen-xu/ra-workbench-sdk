//! Owned source-query observations for the existing manuscript match lookup.
use serde::{Deserialize, Serialize};
/// Original SQL JSON parameter names are snake_case.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CitationSearchKeys {
    pub literature_item_id: String,
    pub bound_key: Option<String>,
    pub first_imported_key: Option<String>,
    pub imported_keys_search_text: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CitationSearchHit {
    pub literature_item_id: String,
    pub title: String,
    pub issued_year: Option<i32>,
    pub container_title: String,
    pub imported_key: String,
    pub first_author: String,
    pub has_pdf: bool,
    pub has_evidence: bool,
    pub citation_key: Option<String>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "phase", rename_all = "camelCase", deny_unknown_fields)]
pub enum SearchInput {
    Prepare { query: String },
    Project { rows: crate::data::DataRows },
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum SearchDecision {
    Needle { needle: String },
    Hits { hits: Vec<CitationSearchHit> },
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CandidatesInput {
    pub doi: String,
    pub title: String,
    #[serde(deserialize_with = "required_optional")]
    pub primary: Option<Vec<String>>,
    #[serde(deserialize_with = "required_optional")]
    pub fallback: Option<Vec<String>>,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CandidatesQuery {
    Doi,
    Title,
    TitleFallback,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum CandidatesPlan {
    Query {
        query: CandidatesQuery,
        parameter: String,
    },
    Ready {
        ids: Vec<String>,
        exact_doi: bool,
    },
}
fn required_optional<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::deserialize(deserializer)
}
