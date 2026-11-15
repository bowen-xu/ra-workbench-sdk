//! Pure editable reading-template validation, distinct from paper snapshots.
use serde::{Deserialize, Serialize};

pub const CAPABILITY_ID: &str = "literature.editable-template-validation";
pub const CAPABILITY_VERSION: u32 = 1;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditableTemplateInputV1 {
    /// Already parsed by Core; the enclosing Catalog does not consume its depth budget.
    pub candidate_json: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditableTemplateOutcomeV1 {
    pub input: Box<EditableTemplateInputV1>,
    pub decision: EditableTemplateDecisionV1,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "status",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum EditableTemplateDecisionV1 {
    Validated { canonical_json: String },
    Rejected { message: String },
}

#[cfg(test)]
mod tests;
