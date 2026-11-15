//! Original legacy reading wire values, shared without a storage or runtime owner.
pub use crate::paper_context_prepare::PaperAiReadingSessionSummary;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PaperAiReadingMessage {
    pub id: String,
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PaperAiReadingTurn {
    pub id: String,
    pub session_id: String,
    pub ordinal: i64,
    pub user_message: String,
    pub assistant_message: String,
    pub messages: Vec<PaperAiReadingMessage>,
    pub provider_id: String,
    pub model_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning_effort: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_window_tokens: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_window_source: Option<String>,
    pub status: String,
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
    pub concept_retrieval_enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub concept_retrieval_trace_id: Option<String>,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub finished_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PaperAiReadingTurnDebugData {
    pub turn_id: String,
    pub raw_request: Option<Value>,
    pub raw_response: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PaperAiReadingSessionDetail {
    #[serde(flatten)]
    pub summary: PaperAiReadingSessionSummary,
    pub turns: Vec<PaperAiReadingTurn>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PaperReadingStructuredHistoryOption {
    pub workflow_id: String,
    pub workflow_revision: i64,
    pub workflow_status: String,
    pub provider_id: String,
    pub model_id: String,
    pub completed_turns: Vec<String>,
    pub attachment_count: usize,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PaperReadingBootstrapOptions {
    pub default_kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub structured_history: Option<PaperReadingStructuredHistoryOption>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unavailable_reason: Option<String>,
}
