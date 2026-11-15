//! Original read-only evidence DTOs. No storage or domain execution authority.
use serde::{Deserialize, Serialize};
pub const CAPABILITY_ID: &str = "literature.evidence-read";

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Claim {
    pub id: String,
    pub project_id: Option<String>,
    pub project_title: Option<String>,
    pub statement: String,
    pub origin: String,
    pub provenance_kind: String,
    pub epistemic_role: String,
    pub revision: i64,
    pub evidence_count: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SourceAnchorSummary {
    pub anchor_id: String,
    pub annotation_id: Option<String>,
    pub item_id: String,
    pub item_title: String,
    pub attachment_id: String,
    pub attachment_name: String,
    pub content_sha256: String,
    pub page_index: i32,
    pub page_label: Option<String>,
    pub rects: serde_json::Value,
    pub quote_exact: String,
    pub quote_prefix: String,
    pub quote_suffix: String,
    pub annotation_type: Option<String>,
    pub annotation_body: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceLink {
    pub id: String,
    pub claim_id: String,
    pub stance: String,
    pub rationale: String,
    pub source: SourceAnchorSummary,
    pub created_at: String,
}
