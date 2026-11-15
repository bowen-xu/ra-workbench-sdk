//! Original attachment DTOs and two finite pure preparations; no file/SQL owner.
use crate::duplicate_review::F64BitsV1;
use serde::{Deserialize, Serialize};

pub const CAPABILITY_ID: &str = "literature.attachments";
pub const CAPABILITY_VERSION: u32 = 1;

// Original Rust names, trait/Serde profiles and nullable output are retained.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadingPosition {
    pub page_index: i32,
    pub zoom: f64,
    pub view_state_json: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageText {
    pub page_index: i32,
    pub text: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentRemovalResult {
    pub file_status: &'static str,
    pub warning: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RenameAttachmentInputV1 {
    pub item_id: String,
    pub attachment_id: String,
    pub display_name: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveReadingStateInputV1 {
    pub item_id: String,
    pub attachment_id: String,
    pub page_index: i32,
    pub zoom: F64BitsV1,
    pub view_state_json: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum AttachmentPrepareInputV1 {
    Rename { request: RenameAttachmentInputV1 },
    SaveReadingState { request: SaveReadingStateInputV1 },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum AttachmentPlanV1 {
    Rename {
        request: RenameAttachmentInputV1,
        display_name: String,
    },
    SaveReadingState {
        request: SaveReadingStateInputV1,
        bounded_zoom: F64BitsV1,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AttachmentRejectionV1 {
    InvalidAttachmentName,
    InvalidReaderViewState,
}

impl<'de> Deserialize<'de> for AttachmentRejectionV1 {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        match String::deserialize(deserializer)?.as_str() {
            "invalidAttachmentName" => Ok(Self::InvalidAttachmentName),
            "invalidReaderViewState" => Ok(Self::InvalidReaderViewState),
            value => Err(serde::de::Error::unknown_variant(
                value,
                &["invalidAttachmentName", "invalidReaderViewState"],
            )),
        }
    }
}

impl AttachmentRejectionV1 {
    pub fn code(self) -> &'static str {
        match self {
            Self::InvalidAttachmentName => "attachment_name_invalid",
            Self::InvalidReaderViewState => "invalid_input",
        }
    }

    pub fn message(self) -> &'static str {
        match self {
            Self::InvalidAttachmentName => "附件名称不能为空、超过 255 个字符或包含控制字符",
            Self::InvalidReaderViewState => "阅读位置不是有效的 ReaderViewStateV2",
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
pub enum AttachmentPreparationV1 {
    Ready {
        plan: Box<AttachmentPlanV1>,
    },
    Rejected {
        input: Box<AttachmentPrepareInputV1>,
        reason: AttachmentRejectionV1,
    },
}

#[cfg(test)]
mod tests;
