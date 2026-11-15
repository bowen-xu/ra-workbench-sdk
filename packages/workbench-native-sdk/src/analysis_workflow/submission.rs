//! Owned domain facts for the existing shared paper submission lifecycle.
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SubmissionScopeV1 {
    pub paper_id: String,
    pub kind: String,
    pub attachment_ids: Vec<String>,
    pub system_text: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CompletionProjectionV1 {
    pub kind: String,
    pub content: serde_json::Value,
    pub template: CompletionTemplateV1,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum CompletionTemplateV1 {
    NotRequired,
    Required { content: Option<serde_json::Value> },
}
