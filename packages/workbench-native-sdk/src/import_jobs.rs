//! Finite import-job contracts; no database, SQL or execution owner.
use crate::{catalog_save::CatalogSaveInput, catalog_save::CatalogSaveOutcome, data::DataRows};
use serde::{Deserialize, Serialize};

pub const CAPABILITY_ID: &str = "literature.import-jobs";
pub const CAPABILITY_VERSION: u32 = 1;

/// Original ImportResult field order and explicit nullable output are retained.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedResult {
    pub input_label: String,
    pub raw_input: String,
    pub state: String,
    pub item_id: Option<String>,
    pub error_message: Option<String>,
}

/// State/source strings and IDs keep their original, unrestricted data meaning.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedJob {
    pub id: String,
    pub state: String,
    pub source_kind: String,
    pub total_count: usize,
    pub completed_count: usize,
    pub cancellation_requested: bool,
    pub results: Vec<ImportedResult>,
    pub created_at: String,
    pub updated_at: String,
}

impl ImportedJob {
    /// Preserve the original static import worker's borrowed identity accessor.
    pub fn id(&self) -> &str {
        &self.id
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ImportJobsRequestV1 {
    Bibtex {
        drafts: Vec<crate::catalog_save::CatalogDraft>,
    },
    Get {
        id: String,
    },
    List {},
    Cancel {
        id: String,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ImportJobsResultV1 {
    Job { job: ImportedJob },
    Jobs { jobs: Vec<ImportedJob> },
    Done {},
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PrepareBibtexInputV1 {
    /// The draft is still the original input; Core only supplies its shared DOI.
    pub inputs: Vec<CatalogSaveInput>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreparedBibtexEntryV1 {
    pub input_label: String,
    pub raw_input: String,
    /// A rejection is consumed at this entry's original save/BEGIN position.
    pub save: CatalogSaveOutcome,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImportFinishStatesV1 {
    pub no_failed: String,
    pub no_imported: String,
    pub mixed: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImportJobRulesV1 {
    pub source_kind: String,
    pub imported_state: String,
    pub failed_state: String,
    pub finish_states: ImportFinishStatesV1,
    pub not_found_message: String,
    pub empty_title_message: String,
    pub unsupported_type_prefix: String,
    pub database_error_prefix: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreparedBibtexV1 {
    pub entries: Vec<PreparedBibtexEntryV1>,
    pub rules: ImportJobRulesV1,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum ImportJobsRejectionV1 {
    EmptyTitle {},
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "status",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum BibtexPreparationV1 {
    Ready {
        plan: Box<PreparedBibtexV1>,
    },
    Rejected {
        reason: ImportJobsRejectionV1,
        message: String,
    },
}

/// The header has its original eight columns; results have the original five.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImportJobRowsV1 {
    pub header: DataRows,
    /// An absent header skips the original result query.
    pub results: Option<DataRows>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ImportJobsProjectionInputV1 {
    Job {
        expected_id: String,
        rows: ImportJobRowsV1,
    },
    Jobs {
        expected_ids: Vec<String>,
        /// Capture stops at the first absent header, before any later query.
        rows: Vec<ImportJobRowsV1>,
    },
    Cancel {
        affected_rows: u64,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "status",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ImportJobsProjectionOutcomeV1 {
    Success { result: ImportJobsResultV1 },
    NotFound { message: String },
}

#[cfg(test)]
mod tests;
