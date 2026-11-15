//! Original selected-file context contracts. Core owns authorization and file access.
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WritingContextRequest {
    pub manuscript_id: Uuid,
    pub files: Vec<WritingContextFile>,
}
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WritingContextFile {
    pub relative_path: String,
    pub expected_disk_sha256: String,
    pub buffer: Option<WritingContextBuffer>,
    pub selection: Option<WritingContextSelection>,
}
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WritingContextBuffer {
    pub revision: Uuid,
    pub text: String,
}
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WritingContextSelection {
    pub start_utf16: usize,
    pub end_utf16: usize,
}
#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize, thiserror::Error)]
#[serde(rename_all = "camelCase")]
pub enum WritingContextError {
    #[error("invalid writing context selection")]
    InvalidInput,
    #[error("writing context changed; refresh its snapshot")]
    Conflict,
    #[error("writing context source unavailable")]
    Unavailable,
    #[error("writing context exceeds its budget")]
    Budget,
}

/// Ordered pure stages of the original selected/current-file materialization.
/// Core supplies only the input observed by this stage and retains all I/O.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(
    tag = "phase",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ContextInput {
    Validate {
        request: WritingContextRequest,
    },
    CurrentFile {
        manuscript_id: Uuid,
        relative_path: String,
        rows: crate::data::DataRows,
    },
    Project {
        manuscript_id: Uuid,
        rows: crate::data::DataRows,
    },
    Registered {
        relative_path: String,
        files: Vec<crate::writing_project::ManuscriptFile>,
    },
    Materialize {
        manuscript_id: Uuid,
        file: WritingContextFile,
        disk: String,
        disk_hash: String,
        used_bytes: usize,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(
    tag = "phase",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ContextDecision {
    Validated {},
    CurrentFile {
        request: WritingContextRequest,
    },
    ProjectAccepted {},
    Registered {},
    Materialized {
        source: research_agent_api::submission::ContextText,
        used_bytes: usize,
    },
    Rejected {
        reason: WritingContextError,
    },
}

#[cfg(test)]
mod tests;
