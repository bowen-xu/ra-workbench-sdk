//! Original analysis-workflow values shared by the static and native adapters.
pub mod candidate;
pub mod docling;
pub mod matrix;
pub mod overview_task;
pub mod prompt;
pub mod recovery;
pub mod research;
pub mod submission;
pub mod template;
pub mod wire;

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SuggestionPromptV1 {
    pub system_text: String,
    pub user_text: String,
}
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PaperAnalysisWorkflowDraft {
    pub paper_id: String,
    pub context_snapshot_id: String,
    pub provider_id: String,
    pub model_id: String,
    pub reasoning_effort: Option<String>,
    pub prompt_set_version: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, thiserror::Error)]
#[serde(
    tag = "kind",
    content = "message",
    rename_all = "camelCase",
    deny_unknown_fields
)]
pub enum AnalysisWorkflowError {
    #[error("{0}")]
    InvalidInput(String),
    #[error("analysis temporarily unavailable")]
    TemporaryUnavailable,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FailureStatuses {
    pub attempt: String,
    pub turn: String,
    pub workflow: String,
}
