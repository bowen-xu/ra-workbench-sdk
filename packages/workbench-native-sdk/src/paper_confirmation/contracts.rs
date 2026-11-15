//! Original field and paper confirmation wire values. No execution or storage owner.
use crate::candidate_review::contracts::{AiCandidate, AiOverviewFieldConfirmation};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiOverviewConfirmationBatch {
    pub id: String,
    pub candidate_id: String,
    pub candidate_revision: i64,
    pub scope_kind: String,
    pub paper_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    pub idempotency_key: String,
    pub created_at: String,
    pub field_confirmations: Vec<AiOverviewFieldConfirmation>,
    pub active: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub undone_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiOverviewFieldConfirmationDraft {
    pub candidate_id: String,
    pub candidate_revision: i64,
    pub field_kinds: Vec<String>,
    pub scope_kind: String,
    #[allow(dead_code)]
    pub project_id: Option<String>,
    pub idempotency_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiOverviewConfirmationUndoDraft {
    pub batch_id: String,
    pub idempotency_key: String,
    pub field_kind: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiOverviewConfirmationResult {
    pub candidate: AiCandidate,
    pub batch: AiOverviewConfirmationBatch,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiPaperReviewOverviewTargetDraft {
    pub candidate_id: String,
    pub candidate_revision: i64,
    pub field_kinds: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiPaperReviewConfirmationDraft {
    pub paper_id: String,
    pub project_id: Option<String>,
    pub metadata_field_names: Vec<String>,
    pub overview_targets: Vec<AiPaperReviewOverviewTargetDraft>,
    pub idempotency_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiPaperReviewConfirmationUndoDraft {
    pub batch_id: String,
    pub idempotency_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiPaperReviewMetadataConfirmation {
    pub id: String,
    pub field_name: String,
    pub active: bool,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub undone_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiPaperReviewConfirmationBatch {
    pub id: String,
    pub paper_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    pub idempotency_key: String,
    pub metadata_confirmations: Vec<AiPaperReviewMetadataConfirmation>,
    pub overview_batch_ids: Vec<String>,
    pub active: bool,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub undone_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiPaperReviewConfirmationResult {
    pub batch: AiPaperReviewConfirmationBatch,
    pub candidates: Vec<AiCandidate>,
    pub module_failures: Vec<String>,
}
