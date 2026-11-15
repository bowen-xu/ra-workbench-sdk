//! Original per-field interpretation, consumed at the original write positions.
use crate::candidate_contracts::CandidateValidationError;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum FieldAnchorV1 {
    Existing {
        id: String,
    },
    Quoted {
        paper_id: String,
        attachment_id: String,
        content_sha256: String,
        page_index: i64,
        page_label: Option<String>,
        quote: String,
        prefix: String,
        suffix: String,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConfirmedFieldV1 {
    pub title: String,
    pub body: String,
    pub unit_kind: String,
    pub template_field: Option<(String, String)>,
    pub decision_kind: String,
    pub provenance_kind: String,
    pub epistemic_role: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FieldPlanV1 {
    /// Each error is consumed after all preceding anchor writes, preserving first failure order.
    pub anchors: Vec<Result<FieldAnchorV1, CandidateValidationError>>,
    pub unit: Result<ConfirmedFieldV1, CandidateValidationError>,
    /// The original hash is consumed only after the reading unit has been written.
    pub hash: Result<String, CandidateValidationError>,
}
