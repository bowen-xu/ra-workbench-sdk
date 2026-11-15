//! Original manual definition and revision codecs, shared without a store owner.
use serde::{Deserialize, Serialize};
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DefinitionClaimDraft {
    pub id: Option<String>,
    pub concept_id: String,
    pub statement: String,
    pub scope_note: String,
    pub anchor_id: Option<String>,
    pub expected_revision: Option<i64>,
    pub change_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResearchObjectRevision {
    pub id: String,
    pub object_kind: String,
    pub object_id: String,
    pub revision: i64,
    pub snapshot: serde_json::Value,
    pub editor_kind: String,
    pub change_reason: String,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum DefinitionRevisionRejectionV1 {
    NewExpectedRevision,
    Conflict { current_revision: i64 },
}
