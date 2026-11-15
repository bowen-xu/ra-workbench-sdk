//! Original reference DTOs and finite save preparation; no storage or runtime owner.
use serde::{Deserialize, Serialize};

pub const CAPABILITY_ID: &str = "literature.reference-records";
pub const CAPABILITY_VERSION: u32 = 1;

// Preserve the original Rust names as well as Serde attributes: names also
// appear in the legacy wrong-type and invalid-length decoding diagnostics.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceMetadataField {
    pub name: String,
    pub value: String,
    pub source_kind: String,
    pub confirmed_by_user: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceRecordDraft {
    pub id: Option<String>,
    pub citing_paper_id: String,
    pub source_anchor_id: String,
    pub raw_text: String,
    #[serde(default)]
    pub fields: Vec<ReferenceMetadataField>,
    pub parse_state: String,
    pub identity_state: String,
    pub matched_item_id: Option<String>,
    pub semantic_state: String,
    pub usage_kind: Option<String>,
    #[serde(default)]
    pub usage_summary: String,
    pub usage_anchor_id: Option<String>,
    pub expected_revision: Option<i64>,
    pub change_reason: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceRecord {
    pub id: String,
    pub citing_paper_id: String,
    pub source_anchor_id: String,
    pub raw_text: String,
    pub fields: Vec<ReferenceMetadataField>,
    pub parse_state: String,
    pub identity_state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub matched_item_id: Option<String>,
    pub semantic_state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage_kind: Option<String>,
    pub usage_summary: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage_anchor_id: Option<String>,
    pub provenance_kind: String,
    pub revision: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReferenceRecordPrepareInputV1 {
    pub draft: ReferenceRecordDraft,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReferenceRecordPlanV1 {
    /// The original input remains intact, including whitespace and nulls.
    pub draft: ReferenceRecordDraft,
    pub raw_text: String,
    pub usage_summary: String,
    pub change_reason: String,
    pub fields_json: String,
    pub snapshot_json: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ReferenceRecordRejectionV1 {
    InvalidFields,
    InvalidStates,
    InvalidMetadataFields,
    AnchorOwnership,
    MatchedItemMissing,
    NewExpectedRevision,
    ImmutableOwner,
    FieldsEncoding,
    SnapshotEncoding,
    StoredFieldsEncoding,
}

impl ReferenceRecordRejectionV1 {
    /// Original public messages; actual revision conflicts bind Core's i64.
    pub fn message(self) -> &'static str {
        match self {
            Self::InvalidFields => "参考条目字段无效",
            Self::InvalidStates => "参考条目状态组合无效",
            Self::InvalidMetadataFields => "参考条目解析字段或来源无效",
            Self::AnchorOwnership => "参考条目来源必须属于当前文献",
            Self::MatchedItemMissing => "匹配的文献对象不存在",
            Self::NewExpectedRevision => "新参考条目不能携带预期版本",
            Self::ImmutableOwner => "参考条目不能改写所属文献或原始来源",
            Self::FieldsEncoding => "参考字段无法序列化",
            Self::SnapshotEncoding => "参考条目版本无法序列化",
            Self::StoredFieldsEncoding => "参考字段存储格式无效",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "status",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ReferenceRecordPreparationV1 {
    Ready {
        plan: Box<ReferenceRecordPlanV1>,
    },
    Rejected {
        #[serde(deserialize_with = "rejection_string")]
        reason: ReferenceRecordRejectionV1,
    },
}

// Serde's default externally-tagged unit enums also accept an object form.
// This new wire field is a string enum; keep the original DTOs' tolerance.
fn rejection_string<'de, D>(deserializer: D) -> Result<ReferenceRecordRejectionV1, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = String::deserialize(deserializer)?;
    ReferenceRecordRejectionV1::deserialize(serde::de::value::StringDeserializer::<D::Error>::new(
        value,
    ))
}

#[cfg(test)]
mod tests;
