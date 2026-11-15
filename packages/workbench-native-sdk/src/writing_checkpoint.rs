//! Original writing checkpoint wire records. Core retains persistence and HBS owners.
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DocumentOperation {
    pub operation_id: String,
    pub conversation_id: String,
    pub request_id: String,
    pub result_sha256: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorReceipt {
    pub operation_id: String,
    pub session_id: String,
    pub revision: String,
    pub text: String,
    #[serde(
        default,
        deserialize_with = "present_state_version",
        skip_serializing_if = "Option::is_none"
    )]
    pub state_version: Option<u64>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveIntent {
    pub operation_id: String,
    pub version: u64,
    pub expected_sha256: String,
    pub target_sha256: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DocumentCheckpoint {
    pub schema_version: u32,
    pub manuscript_id: String,
    pub relative_path: String,
    pub version: u64,
    pub content: String,
    pub review_baseline: String,
    pub saved_sha256: String,
    pub saved_version: u64,
    pub operations: Vec<DocumentOperation>,
    #[serde(deserialize_with = "required_save_intent")]
    pub save_intent: Option<SaveIntent>,
    /// Legacy records have no receipt. Only a strictly observed dispatch may add one.
    #[serde(
        default,
        deserialize_with = "present_editor_receipt",
        skip_serializing_if = "Option::is_none"
    )]
    pub editor_receipt: Option<EditorReceipt>,
}

fn required_save_intent<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<SaveIntent>, D::Error> {
    Option::<SaveIntent>::deserialize(deserializer)
}

fn present_editor_receipt<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<EditorReceipt>, D::Error> {
    EditorReceipt::deserialize(deserializer).map(Some)
}

fn present_state_version<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<u64>, D::Error> {
    u64::deserialize(deserializer).map(Some)
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointRecord {
    pub revision: u64,
    pub checkpoint: DocumentCheckpoint,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CheckpointWrite {
    pub expected_revision: Option<u64>,
    pub checkpoint: DocumentCheckpoint,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CheckpointPlan {
    pub write: CheckpointWrite,
    pub record: CheckpointRecord,
    pub write_required: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(
    tag = "phase",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum CheckpointInput {
    Validate {
        write: Box<CheckpointWrite>,
    },
    Read {
        manuscript_id: String,
        relative_path: String,
        required: bool,
        rows: crate::data::DataRows,
    },
    Save {
        write: Box<CheckpointWrite>,
        #[serde(deserialize_with = "required_record")]
        current: Option<Box<CheckpointRecord>>,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(
    tag = "phase",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum CheckpointDecision {
    Validated {
        write: Box<CheckpointWrite>,
    },
    Read {
        #[serde(deserialize_with = "required_record")]
        record: Option<Box<CheckpointRecord>>,
    },
    Save {
        plan: Box<CheckpointPlan>,
    },
    Rejected {
        reason: crate::writing_project::Rejection,
    },
}

fn required_record<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer)
}

#[cfg(test)]
mod tests;
