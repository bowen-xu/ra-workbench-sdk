//! Original preparation observations, without model, storage or process owners.
use crate::paper_context::PaperAiReadingAttachmentStatus;
use serde::{Deserialize, Serialize};
pub const CAPABILITY_ID: &str = "literature.paper-context-prepare";
pub const CAPABILITY_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PaperAiReadingSessionSummary {
    pub id: String,
    pub paper_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_snapshot_id: Option<String>,
    pub attachment_ids: Vec<String>,
    pub parse_run_ids: Vec<String>,
    pub provider_id: String,
    pub model_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning_effort: Option<String>,
    pub bootstrap_kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_workflow_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_workflow_revision: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bootstrap_hash: Option<String>,
    pub concept_retrieval_default: bool,
    pub title: String,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReadingSessionRowV1 {
    pub id: String,
    pub paper_id: String,
    pub context_snapshot_id: Option<String>,
    pub attachment_ids_json: String,
    pub parse_run_ids_json: String,
    pub provider_id: String,
    pub model_id: String,
    pub reasoning_effort: Option<String>,
    pub bootstrap_kind: String,
    pub source_workflow_id: Option<String>,
    pub source_workflow_revision: Option<i64>,
    pub bootstrap_hash: Option<String>,
    pub concept_retrieval_default: bool,
    pub title: String,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum PaperPreparationInputV1 {
    AnalysisSources {
        statuses: Vec<String>,
        picture_count: usize,
    },
    Session {
        row: Option<Box<ReadingSessionRowV1>>,
    },
    SnapshotReady {
        attachment_statuses: Vec<PaperAiReadingAttachmentStatus>,
    },
    ImageIdentity {
        context_item_id: String,
        existing_ids: Vec<String>,
    },
    ImageSet {
        requested_ids: Vec<String>,
        available_ids: Vec<String>,
    },
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum PaperPreparationDecisionV1 {
    Session {
        session: Box<PaperAiReadingSessionSummary>,
    },
    Ready {
        available: bool,
    },
    Validated {},
    Rejected {
        message: String,
    },
}
