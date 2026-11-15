//! Owned scalar rows captured in the original database decoder order.
use super::contracts::PaperAnalysisMessage;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkflowRowV1 {
    pub id: String,
    pub conversation_id: Option<String>,
    pub paper_id: String,
    pub context_snapshot_id: String,
    pub status: String,
    pub provider_id: String,
    pub model_id: String,
    pub reasoning_effort: Option<String>,
    pub prompt_set_version: String,
    pub active_turn_kind: Option<String>,
    pub revision: i64,
    pub supersedes_workflow_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub completed_at: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TurnRowV1 {
    pub id: String,
    pub workflow_id: String,
    pub ordinal: i64,
    pub kind: String,
    pub status: String,
    pub candidate_id: Option<String>,
    pub created_at: String,
    pub finished_at: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AttemptRowV1 {
    pub id: String,
    pub turn_id: String,
    pub shared_conversation_id: Option<String>,
    pub shared_turn_outcome: Option<String>,
    pub shared_request_id: Option<String>,
    pub shared_turn_id: Option<String>,
    pub shared_ai_run_id: Option<String>,
    pub shared_candidate_id: Option<String>,
    pub shared_terminal_status: Option<String>,
    pub attempt: i64,
    pub status: String,
    pub normalized_messages: Vec<PaperAnalysisMessage>,
    pub provider_id: String,
    pub model_id: String,
    pub reasoning_effort: Option<String>,
    pub ai_run_id: Option<String>,
    pub candidate_id: Option<String>,
    pub input_hash: Option<String>,
    pub output_hash: Option<String>,
    pub input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
    pub created_at: String,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub recovery_reason: Option<String>,
    pub recovery_version: Option<i64>,
    pub recovered_at: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CapturedWorkflowV1 {
    pub row: WorkflowRowV1,
    pub turns: Vec<CapturedTurnV1>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CapturedTurnV1 {
    pub row: TurnRowV1,
    pub attempts: Vec<AttemptRowV1>,
}
