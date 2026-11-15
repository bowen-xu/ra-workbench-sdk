//! Original task drafts and model-selection values. No runtime, credentials or storage.
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LlmModelSelectionDraft {
    pub provider_id: String,
    pub model_id: String,
    pub reasoning_effort: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DerivedViewInputRef {
    pub object_kind: String,
    pub object_id: String,
    pub object_revision: i64,
    pub selection_reason: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiScopeItemDraft {
    pub item_kind: String,
    pub object_id: String,
    pub parent_object_id: Option<String>,
    pub content_sha256: Option<String>,
    pub object_revision: Option<i64>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiTaskSpecDraft {
    pub task_kind: String,
    pub provider_id: String,
    pub model_selection: Option<LlmModelSelectionDraft>,
    pub user_goal: String,
    pub pipeline_version: String,
    pub prompt_version: String,
    pub output_schema_version: i64,
    pub max_input_tokens: i64,
    pub max_output_tokens: i64,
    pub timeout_ms: i64,
    pub scope_items: Vec<AiScopeItemDraft>,
    #[serde(default)]
    pub overview_fields: Vec<String>,
    pub overview_profile_selection_revision: Option<i64>,
    pub paper_template_ref: Option<crate::candidate_contracts::PaperTemplateRef>,
    pub suggestion_candidate_kind: Option<String>,
    pub matrix_synthesis_context: Option<AiMatrixSynthesisContextDraft>,
    pub base_candidate_id: Option<String>,
    pub base_candidate_revision: Option<i64>,
    pub confirmed_scope_hash: Option<String>,
    pub cloud_consent_version: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiMatrixSynthesisContextDraft {
    pub project_id: String,
    pub matrix_id: String,
    pub matrix_revision: i64,
    pub view_kind: String,
    pub title: String,
    pub scope_note: String,
    pub inputs: Vec<DerivedViewInputRef>,
}

pub mod evidence;

pub const SUGGESTION_CANDIDATE_KINDS: [&str; 4] = [
    "concept_suggestion_v1",
    "definition_suggestion_v1",
    "relation_suggestion_v1",
    "attention_suggestion_v1",
];

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiMatrixSynthesisContext {
    pub project_id: String,
    pub matrix_id: String,
    pub matrix_revision: i64,
    pub view_kind: String,
    pub title: String,
    pub scope_note: String,
    pub inputs: Vec<DerivedViewInputRef>,
    pub evidence_anchor_ids: Vec<String>,
}

pub mod provider;
