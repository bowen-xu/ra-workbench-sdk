//! Finite unreviewed-field selection; resource identity only binds the result.
use serde::{Deserialize, Serialize};

pub const CAPABILITY_ID: &str = "literature.unreviewed-selection";
pub const CAPABILITY_VERSION: u32 = 1;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UnreviewedSelectionInputV1 {
    pub resource_id: String,
    pub resource_revision: i64,
    /// Original order and repeated field identities are significant.
    pub pending_field_ids: Vec<String>,
    pub protected_field_ids: Vec<String>,
    pub reviewed_field_ids: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UnreviewedSelectionV1 {
    pub input: Box<UnreviewedSelectionInputV1>,
    pub selected_field_ids: Vec<String>,
}

#[cfg(test)]
mod tests;
