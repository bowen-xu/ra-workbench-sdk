//! Original shared evidence preview and pure page observations.
use serde::{Deserialize, Serialize};

pub const PAGE_EVIDENCE_CONFIG_VERSION: &str = "paper-overview-pages-v1";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiEvidencePreview {
    pub citation_key: String,
    pub anchor_id: String,
    pub paper_title: String,
    pub attachment_id: String,
    pub content_sha256: String,
    pub page_index: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub page_label: Option<String>,
    pub quote_exact: String,
    pub context_text: String,
    pub relation_kind: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AttachmentEvidence {
    pub paper_id: String,
    pub paper_title: String,
    pub content_sha256: String,
    pub index_state: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OverviewPageEvidence {
    pub anchor_id: String,
    pub paper_id: String,
    pub paper_title: String,
    pub attachment_id: String,
    pub content_sha256: String,
    pub page_index: i64,
    pub quote_exact: String,
    pub quote_prefix: String,
    pub quote_suffix: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreparedPageEvidence {
    pub source: OverviewPageEvidence,
    pub citation_key: String,
    pub context: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnchorEvidence {
    pub anchor_id: String,
    pub paper_id: String,
    pub paper_title: String,
    pub attachment_id: String,
    pub content_sha256: String,
    pub page_index: i64,
    pub page_label: Option<String>,
    pub quote_exact: String,
    pub quote_prefix: String,
    pub quote_suffix: String,
}
