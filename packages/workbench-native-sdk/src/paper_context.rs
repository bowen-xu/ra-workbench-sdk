//! Pure paper-context values; no session, provider, persistence or runtime owner.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
mod optional_value;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PaperContextBuildInputV1 {
    pub paper_id: String,
    pub attachments: Vec<ContextAttachmentV1>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContextAttachmentV1 {
    pub id: String,
    pub display_name: String,
    pub content_sha256: String,
    pub parse: Option<ContextParseRunV1>,
    pub has_stale_parse: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContextParseRunV1 {
    pub id: String,
    pub json_content: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreparedPaperContextV1 {
    pub attachment_statuses: Vec<PaperAiReadingAttachmentStatus>,
    pub context_items: Vec<PaperAiReadingContextItem>,
    pub image_requests: Vec<PaperAiReadingImageRequest>,
    pub text_item_count: usize,
    pub table_item_count: usize,
    pub picture_item_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SnapshotProjectionInputV1 {
    pub paper_id: String,
    pub attachment_statuses: Vec<PaperAiReadingAttachmentStatus>,
    pub context_items: Vec<PaperAiReadingContextItem>,
    pub image_hashes: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SnapshotProjectionV1 {
    pub context_schema_version: i64,
    pub attachments: Vec<PaperContextAttachment>,
    pub items: Vec<PaperContextItem>,
    pub context_hash: String,
    pub snapshot_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SnapshotDigestInputV1 {
    pub context_schema_version: i64,
    pub paper_id: String,
    pub attachments: Vec<PaperContextAttachment>,
    pub items: Vec<PaperContextItem>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PaperAiReadingRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PaperAiReadingRegion {
    pub page_index: u32,
    pub rect: PaperAiReadingRect,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PaperAiReadingContextItem {
    pub id: String,
    pub paper_id: String,
    pub attachment_id: String,
    pub content_sha256: String,
    pub parse_run_id: String,
    pub raw_ref: String,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub page_index: Option<u32>,
    pub regions: Vec<PaperAiReadingRegion>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub charspan: Option<[u32; 2]>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_text_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default, with = "optional_value")]
    pub table_json: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PaperAiReadingImageRequest {
    pub context_item_id: String,
    pub attachment_id: String,
    pub page_index: u32,
    pub regions: Vec<PaperAiReadingRegion>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PaperAiReadingAttachmentStatus {
    pub attachment_id: String,
    pub display_name: String,
    pub content_sha256: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parse_run_id: Option<String>,
    pub parse_status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PaperContextAttachment {
    pub attachment_id: String,
    pub content_sha256: String,
    pub parse_run_id: String,
    pub ordinal: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PaperContextItem {
    pub id: String,
    pub attachment_id: String,
    pub content_sha256: String,
    pub parse_run_id: String,
    pub raw_ref: String,
    pub kind: String,
    pub label: Option<String>,
    pub page_index: Option<u32>,
    pub regions: Vec<PaperAiReadingRegion>,
    pub charspan: Option<[u32; 2]>,
    pub source_text_hash: Option<String>,
    pub text: Option<String>,
    #[serde(default, with = "optional_value")]
    pub table_json: Option<serde_json::Value>,
    pub image_content_sha256: Option<String>,
}

#[cfg(test)]
mod tests;
