//! Original immutable preview values and finite validation observations.
use crate::paper_context::{PaperContextAttachment, PaperContextItem, SnapshotDigestInputV1};
use serde::{Deserialize, Serialize};

pub const CAPABILITY_ID: &str = "literature.paper-context-preview";
pub const CAPABILITY_VERSION: u32 = 1;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PaperContextRequest {
    pub paper_id: String,
    pub snapshot_id: String,
    pub expected_context_hash: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, thiserror::Error)]
#[serde(rename_all = "camelCase")]
pub enum PaperContextError {
    #[error("invalid paper context request")]
    InvalidInput,
    #[error("paper context unavailable")]
    Unavailable,
    #[error("paper context identity changed")]
    Conflict,
    #[error("paper context is corrupt or unsupported")]
    Corrupt,
    #[error("paper context exceeds its preview budget")]
    Budget,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PaperContextPreview {
    pub schema_version: u8,
    pub paper_id: String,
    pub snapshot_id: String,
    pub context_hash: String,
    pub attachments: Vec<PaperContextAttachment>,
    pub items: Vec<PaperContextPreviewItem>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct PaperContextPreviewItem {
    pub source_id: String,
    /// The old id is a snapshot-local display alias, never a global source key.
    pub item: PaperContextItem,
}

// Flattened JSON is the original public/persisted shape. Binary transport keeps
// the item nested so Serde buffering cannot turn a present JSON null into None
// or a tagged wrapper while decoding optional_value.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct JsonPreviewItemRef<'a> {
    source_id: &'a str,
    #[serde(flatten)]
    item: &'a PaperContextItem,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct JsonPreviewItem {
    source_id: String,
    #[serde(flatten)]
    item: PaperContextItem,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BinaryPreviewItem<T> {
    source_id: String,
    item: T,
}
impl Serialize for PaperContextPreviewItem {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        if serializer.is_human_readable() {
            return JsonPreviewItemRef {
                source_id: &self.source_id,
                item: &self.item,
            }
            .serialize(serializer);
        }
        BinaryPreviewItem {
            source_id: self.source_id.clone(),
            item: &self.item,
        }
        .serialize(serializer)
    }
}
impl<'de> Deserialize<'de> for PaperContextPreviewItem {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        if deserializer.is_human_readable() {
            let value = JsonPreviewItem::deserialize(deserializer)?;
            return Ok(Self {
                source_id: value.source_id,
                item: value.item,
            });
        }
        let value = BinaryPreviewItem::deserialize(deserializer)?;
        Ok(Self {
            source_id: value.source_id,
            item: value.item,
        })
    }
}

pub fn hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}
pub fn identity(value: &str) -> bool {
    !value.trim().is_empty() && value.len() <= 1024 && !value.chars().any(char::is_control)
}

pub fn snapshot_id_matches_hash(snapshot_id: &str, context_hash: &str) -> bool {
    let canonical = format!("paper-context-{context_hash}");
    if snapshot_id == canonical {
        return true;
    }
    let migrated_prefix = format!("{canonical}-migrated-");
    let Some(suffix) = snapshot_id.strip_prefix(&migrated_prefix) else {
        return false;
    };
    suffix.len() == 16 && suffix.bytes().all(|byte| byte.is_ascii_hexdigit())
}

impl PaperContextRequest {
    pub fn validate(&self) -> Result<(), PaperContextError> {
        if !identity(&self.paper_id)
            || !hash(&self.expected_context_hash)
            || !snapshot_id_matches_hash(&self.snapshot_id, &self.expected_context_hash)
        {
            return Err(PaperContextError::InvalidInput);
        }
        Ok(())
    }
}

/// Each observation is captured only after its preceding stage succeeds.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum PaperContextPreviewInputV1 {
    Header {
        request: PaperContextRequest,
        header: Option<(String, String, i64)>,
    },
    Preflight {
        item_count: usize,
        item_bytes: usize,
        invalid_page_count: usize,
        attachment_count: usize,
        attachment_bytes: usize,
    },
    Snapshot {
        request: PaperContextRequest,
        snapshot: SnapshotDigestInputV1,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum PaperContextPreviewDecisionV1 {
    Validated {},
    Previewed { preview: PaperContextPreview },
    Rejected { error: PaperContextError },
}
