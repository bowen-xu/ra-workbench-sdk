//! Finite duplicate-undo preparation over the original raw stored snapshot.
use crate::duplicate_merge::{CollectionAssignment, CollectionMembership};
use serde::{Deserialize, Serialize};

pub const CAPABILITY_ID: &str = "literature.duplicate-undo";
pub const CAPABILITY_VERSION: u32 = 1;

/// Keep the original JSON as text rather than adding another recursive wrapper.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UndoMergePrepareInputV1 {
    pub snapshot_json: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreparedDuplicateUndoV1 {
    pub snapshot_sha256: String,
    pub classification: Option<PreparedClassificationUndoV1>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreparedClassificationUndoV1 {
    pub expected_memberships_json: String,
    pub expected_assignments_json: String,
    pub delete_assignments: Vec<CollectionAssignment>,
    pub delete_memberships: Vec<CollectionMembership>,
    pub nal: Option<PreparedNalUndoV1>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreparedNalUndoV1 {
    pub expected_statements_json: String,
    pub expected_annotations_json: String,
    pub delete_statement_ids: Vec<String>,
    pub delete_annotation_ids: Vec<String>,
}

#[cfg(test)]
mod tests;
