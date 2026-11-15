//! Owned inputs for the original bibliography adoption decisions.
use super::{BibliographyError, required_optional};
use crate::writing_project::ManuscriptFile;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImportedEntry {
    pub key: String,
    pub original_key: String,
    pub original: String,
    pub normalized: String,
    pub metadata: Value,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImportedFile {
    pub path: String,
    pub original: String,
    pub support: String,
    pub entries: Vec<ImportedEntry>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum GeneratedHash {
    Unqueried,
    Ready {
        #[serde(deserialize_with = "required_optional")]
        value: Option<String>,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FileSelection {
    Skip,
    NeedGeneratedHash,
    Read,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PublicationChoice {
    NeedProof,
    Publish,
    Verify,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum AdoptionInput {
    ResourcePath {
        relative_path: String,
    },
    NormalizeResources {
        sources: Vec<(String, String)>,
        occupied: Vec<String>,
    },
    ResourceSource {
        source: String,
        mapping: std::collections::BTreeMap<String, String>,
        existing: bool,
    },
    NormalizeBinding {
        entry: String,
        key: String,
    },
    FromLibrary {
        #[serde(deserialize_with = "required_optional")]
        template: Option<String>,
        key: String,
        item: Value,
    },
    Publication {
        always: bool,
        #[serde(deserialize_with = "required_optional")]
        proof_current: Option<bool>,
    },
    SelectFile {
        file: Box<ManuscriptFile>,
        known: bool,
        generated: GeneratedHash,
    },
    Parse {
        physical_files: Vec<(String, String)>,
        #[serde(deserialize_with = "required_optional")]
        originals: Option<Vec<(String, String)>>,
        occupied: Vec<String>,
    },
    ValidateEntry {
        entry: Box<ImportedEntry>,
        path: String,
        #[serde(deserialize_with = "required_optional")]
        originals: Option<Vec<(String, String)>>,
        files: Vec<ManuscriptFile>,
    },
    MatchLibrary {
        normalized_doi: String,
        draft: Value,
        exact_doi: bool,
        candidates: Vec<Value>,
    },
    CanonicalEntry {
        entry: Box<ImportedEntry>,
        #[serde(deserialize_with = "required_optional")]
        library: Option<Value>,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum AdoptionDecision {
    ResourcePath {
        file_kind: String,
        managed_bibliography: bool,
    },
    ResourcesNormalized {
        plan: ResourceNormalization,
    },
    ResourceSource {
        text: String,
    },
    PublicationChosen {
        result: PublicationChoice,
    },
    Selected {
        result: FileSelection,
    },
    Parsed {
        files: Vec<ImportedFile>,
    },
    EntryAccepted,
    LibraryMatched {
        #[serde(deserialize_with = "required_optional")]
        item: Option<Value>,
    },
    CanonicalEntry {
        text: String,
    },
    Rejected {
        reason: BibliographyError,
    },
}

/// Original resource-upload normalization, before any destination byte is published.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResourceNormalization {
    pub files: Vec<(String, String)>,
    pub mapping: std::collections::BTreeMap<String, String>,
    pub document_mapping: std::collections::BTreeMap<String, String>,
}
