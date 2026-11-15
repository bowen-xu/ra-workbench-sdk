//! Original metadata DTOs and finite preparation shapes; no domain policy or I/O.
use crate::catalog::CatalogCreator;
use serde::{Deserialize, Serialize};

mod inputs;
mod plans;
pub use inputs::*;
pub use plans::*;

pub const CAPABILITY_ID: &str = "literature.metadata";
pub const CAPABILITY_VERSION: u32 = 1;

// Original Rust names and Serde attributes retain their legacy diagnostics,
// defaults and unknown-field tolerance. Only new containers are strict.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetadataFieldDiff {
    pub field_name: String,
    pub current_value: String,
    pub candidate_value: String,
    pub user_confirmed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(tag = "fieldName", content = "value", rename_all = "camelCase")]
pub enum LiteratureMetadataPatch {
    ItemType(String),
    Title(String),
    AbstractText(String),
    IssuedYear(Option<i32>),
    ContainerTitle(String),
    ConferenceName(String),
    ProceedingsTitle(String),
    Place(String),
    Volume(String),
    Issue(String),
    Pages(String),
    Doi(String),
    Url(String),
    Language(String),
    BibtexKey(String),
    Creators(Vec<CatalogCreator>),
    Tags(Vec<String>),
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum MetadataCandidateChoice {
    Candidate,
    Current,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum MetadataCandidateTrust {
    Reviewable,
    Trusted,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetadataCandidateFieldDecision {
    pub field_name: String,
    pub choice: MetadataCandidateChoice,
}

#[cfg(test)]
mod tests;
