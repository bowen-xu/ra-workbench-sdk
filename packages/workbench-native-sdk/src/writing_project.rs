//! Original manuscript, file and recovery DTOs shared across the native boundary.
//! These declarations carry no storage, application or runtime owner.
use serde::{Deserialize, Serialize};

pub const STANDALONE_PROJECT_ID: &str = "__standalone_writing__";

mod operations;
pub use operations::{
    CitationKeyRecovery, CitationKeyWrite, CreationPlan, Decision, InitialTemplate, Input,
    Metadata, MetadataDecision, Operation, Output, ProjectScope, RecoveryRetention, Rejection,
};

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ManuscriptDraft {
    pub project_id: Option<String>,
    pub title: String,
    pub root_path: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Manuscript {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub root_path: String,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManuscriptFile {
    pub manuscript_id: String,
    pub relative_path: String,
    pub kind: String,
    pub size_bytes: i64,
    pub sha256: String,
    pub modified_at: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManuscriptFileContent {
    pub relative_path: String,
    pub content: String,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HostResourceFile {
    pub relative_path: String,
    pub kind: String,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CitationBinding {
    pub manuscript_id: String,
    pub literature_item_id: String,
    pub citation_key: String,
    pub bibtex_entry: String,
    pub state: String,
    pub pinned_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BibliographyStatus {
    pub relative_path: String,
    pub content_hash: Option<String>,
    pub generated_at: Option<String>,
    pub status: String,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CitationMetadataKind {
    Bindings,
    BibliographyStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ManuscriptDirectory {
    pub relative_path: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SaveFileRequest {
    pub manuscript_id: String,
    pub relative_path: String,
    pub content: String,
    pub expected_sha256: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WritingSessionDraft {
    pub manuscript_id: String,
    pub open_paths: Vec<String>,
    pub active_path: Option<String>,
    pub cursor_state: serde_json::Value,
    pub layout_state: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WritingSession {
    pub manuscript_id: String,
    pub open_paths: Vec<String>,
    pub active_path: Option<String>,
    pub cursor_state: serde_json::Value,
    pub layout_state: serde_json::Value,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryDraftInput {
    pub manuscript_id: String,
    pub relative_path: String,
    pub base_sha256: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryDraft {
    pub manuscript_id: String,
    pub relative_path: String,
    pub base_sha256: String,
    pub content: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateManuscriptRequest {
    pub manuscript_id: String,
    pub title: Option<String>,
    pub root_path: Option<String>,
}

/// Original upload result over Core-owned manuscript resources.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ManuscriptResourceImportResult {
    pub imported_paths: Vec<String>,
    pub byte_size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ManuscriptTransferResult {
    pub manuscript: Manuscript,
    pub file_count: usize,
    pub root_candidates: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ManuscriptExportResult {
    pub destination_path: String,
    pub file_count: usize,
    pub byte_size: u64,
}
