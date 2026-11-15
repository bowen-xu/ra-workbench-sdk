//! Frozen values used by the original two research-candidate policies.
use serde::{Deserialize, Serialize};
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResearchPromptInputV1 {
    pub task_kind: String,
    pub user_goal: String,
    pub matrix_context: Option<crate::generation::AiMatrixSynthesisContext>,
    pub validation_status: String,
    pub items: Vec<ResearchEvidenceItemV1>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResearchEvidenceItemV1 {
    pub citation_key: String,
    pub paper_id: String,
    pub paper_title: String,
    pub quote_exact: String,
    pub context_text: String,
    pub content_sha256: String,
    pub page_index: i64,
    pub validation_status: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResearchPromptV1 {
    pub system_text: String,
    pub user_text: String,
}
