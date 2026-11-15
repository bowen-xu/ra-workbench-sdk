//! Frozen identities consumed by the original overview task constructor.
use crate::{candidate_contracts::PaperTemplateRef, generation::LlmModelSelectionDraft};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OverviewTaskInputV1 {
    pub paper_id: String,
    pub attachment_ids: Vec<String>,
    pub selection_revision: i64,
    pub template: Option<PaperTemplateRef>,
    pub model_selection: Option<LlmModelSelectionDraft>,
}
