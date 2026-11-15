//! Original analysis history output fields and message values.
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaperAnalysisWorkflow {
    pub id: String,
    /// Ephemeral task owner; never infer cancellation identity from a model turn.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_client_request_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conversation_id: Option<uuid::Uuid>,
    pub paper_id: String,
    pub context_snapshot_id: String,
    pub status: String,
    pub provider_id: String,
    pub model_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning_effort: Option<String>,
    pub prompt_set_version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_turn_kind: Option<String>,
    pub revision: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub supersedes_workflow_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
    pub turns: Vec<PaperAnalysisTurn>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaperAnalysisTurn {
    pub id: String,
    pub workflow_id: String,
    pub ordinal: i64,
    pub kind: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub candidate_id: Option<String>,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub finished_at: Option<String>,
    pub attempts: Vec<PaperAnalysisAttempt>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaperAnalysisAttempt {
    pub id: String,
    pub turn_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shared_conversation_id: Option<uuid::Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shared_turn_outcome: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shared_request_id: Option<uuid::Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shared_turn_id: Option<uuid::Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shared_ai_run_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shared_candidate_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shared_terminal_status: Option<String>,
    pub attempt: i64,
    pub status: String,
    pub normalized_messages: Vec<PaperAnalysisMessage>,
    pub provider_id: String,
    pub model_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning_effort: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ai_run_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub candidate_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input_tokens: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_tokens: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub finished_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recovery_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recovery_version: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recovered_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PaperAnalysisMessage {
    pub kind: PaperAnalysisMessageKind,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_turn_id: Option<String>,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PaperAnalysisMessageKind {
    SystemContext,
    TaskPrompt,
    AssistantCandidate,
    Transition,
}

impl PaperAnalysisMessage {
    pub fn new(kind: PaperAnalysisMessageKind, content: impl Into<String>) -> Self {
        Self {
            kind,
            content: content.into(),
            source_turn_id: None,
        }
    }
}
