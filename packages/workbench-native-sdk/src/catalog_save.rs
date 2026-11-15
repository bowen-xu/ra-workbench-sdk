//! Pure manual-catalog save inputs and domain preparation, without SQL or a writer.
use crate::catalog::CatalogCreator;
use serde::{Deserialize, Deserializer, Serialize};

pub const CAPABILITY_ID: &str = "literature.catalog-save";
pub const CAPABILITY_VERSION: u32 = 1;

/// Original LiteratureDraft input defaults and unknown-field tolerance remain intact.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogDraft {
    pub id: Option<String>,
    pub item_type: String,
    pub title: String,
    #[serde(default)]
    pub abstract_text: String,
    pub issued_year: Option<i32>,
    #[serde(default)]
    pub container_title: String,
    #[serde(default)]
    pub conference_name: String,
    #[serde(default)]
    pub proceedings_title: String,
    #[serde(default)]
    pub place: String,
    #[serde(default)]
    pub volume: String,
    #[serde(default)]
    pub issue: String,
    #[serde(default)]
    pub pages: String,
    #[serde(default)]
    pub doi: String,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub language: String,
    #[serde(default)]
    pub bibtex_key: String,
    pub raw_bibtex: Option<String>,
    #[serde(default)]
    pub creators: Vec<CatalogCreator>,
    #[serde(default)]
    pub tags: Vec<String>,
    pub source_kind: Option<String>,
}

/// Produced by Core's existing shared DOI parser; the domain decides whether to persist it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreparedDoi {
    pub display: String,
    pub normalized: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CatalogSaveInput {
    pub draft: CatalogDraft,
    pub doi: PreparedDoi,
}

/// The original sixteen main-record bindings, before Core assigns a missing item ID.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CatalogSaveItem {
    pub id: Option<String>,
    pub item_type: String,
    pub title: String,
    pub abstract_text: String,
    pub issued_year: Option<i32>,
    pub container_title: String,
    pub conference_name: String,
    pub proceedings_title: String,
    pub place: String,
    pub volume: String,
    pub issue: String,
    pub pages: String,
    pub url: String,
    pub language: String,
    pub bibtex_key: String,
    pub raw_bibtex: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CatalogSaveProvenance {
    pub fields: Vec<String>,
    pub source_kind: String,
    pub confirmed_by_user: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CatalogDuplicatePolicy {
    pub normalized_title: String,
    pub doi_reason: String,
    pub doi_confidence: f64,
    pub title_reason: String,
    pub title_confidence: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CatalogSavePlan {
    pub item: CatalogSaveItem,
    pub creators: Vec<CatalogCreator>,
    pub doi: Option<PreparedDoi>,
    pub tags: Vec<String>,
    pub provenance: CatalogSaveProvenance,
    pub duplicates: CatalogDuplicatePolicy,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum CatalogSaveRejection {
    UnsupportedType { item_type: String },
    EmptyTitle,
}

impl<'de> Deserialize<'de> for CatalogSaveRejection {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(
            tag = "kind",
            rename_all = "camelCase",
            rename_all_fields = "camelCase",
            deny_unknown_fields
        )]
        enum Wire {
            UnsupportedType { item_type: String },
            EmptyTitle {},
        }
        Ok(match Wire::deserialize(deserializer)? {
            Wire::UnsupportedType { item_type } => Self::UnsupportedType { item_type },
            Wire::EmptyTitle {} => Self::EmptyTitle,
        })
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum CatalogSaveOutcome {
    Planned { plan: Box<CatalogSavePlan> },
    Rejected { reason: CatalogSaveRejection },
}

#[cfg(test)]
mod tests;
