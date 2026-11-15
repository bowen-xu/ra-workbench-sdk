//! Original duplicate candidate endpoint choice, without a persistence owner.
use serde::{Deserialize, Serialize};

pub const CAPABILITY_ID: &str = "literature.duplicate-merge";
pub const CAPABILITY_VERSION: u32 = 1;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MergePrepareInputV1 {
    pub candidate_id: String,
    pub survivor_item_id: String,
    pub left_item_id: String,
    pub right_item_id: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MergeRejectionV1 {
    NotFound,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "status",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum MergePreparationV1 {
    Ready {
        input: MergePrepareInputV1,
        merged_item_id: String,
        operation_state: String,
        created_reading_state: bool,
    },
    Rejected {
        reason: MergeRejectionV1,
    },
}

#[cfg(test)]
mod tests;
