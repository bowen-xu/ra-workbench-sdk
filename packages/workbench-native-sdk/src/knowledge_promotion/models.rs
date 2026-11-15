//! Original shared snapshot DTOs with the original field and Serde order.
use crate::concepts::Term;
use serde::Serialize;
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TermUsage {
    pub id: String,
    pub term: Term,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub concept_id: Option<String>,
    pub anchor_id: String,
    pub paper_id: String,
    pub paper_title: String,
    pub attachment_id: String,
    pub content_sha256: String,
    pub page_index: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub page_label: Option<String>,
    pub quote_exact: String,
    pub usage_text: String,
    pub provenance_kind: String,
    pub revision: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DefinitionClaim {
    pub id: String,
    pub concept_id: String,
    pub statement: String,
    pub scope_note: String,
    pub provenance_kind: String,
    pub epistemic_role: String,
    pub revision: i64,
    pub evidence_count: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelationNodeSummary {
    pub kind: String,
    pub id: String,
    pub label: String,
    pub detail: String,
}
