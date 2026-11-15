//! Original note-asset result and finite import metadata validation.
use serde::{Deserialize, Serialize};

pub const MAX_BYTES: usize = 16 * 1024 * 1024;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteAsset {
    pub asset_id: String,
    pub display_name: String,
    pub mime_type: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImportInput {
    pub display_name: String,
    pub mime_type: String,
    pub byte_size: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, thiserror::Error)]
#[serde(rename_all = "camelCase")]
pub enum Rejection {
    #[error("附件超过 16 MiB 限制")]
    TooLarge,
    #[error("稿件路径无效")]
    InvalidPath,
    #[error("稿件信息无效")]
    InvalidManuscript,
}

impl Rejection {
    pub fn code(&self) -> &'static str {
        match self {
            Self::TooLarge => "compile_process_error",
            Self::InvalidPath | Self::InvalidManuscript => "invalid_input",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum Decision {
    Validated,
    Rejected { reason: Rejection },
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn original_result_and_metadata_only_input_keep_wire_fields() {
        let value = NoteAsset {
            asset_id: "id".into(),
            display_name: "paper.pdf".into(),
            mime_type: "application/pdf".into(),
        };
        let json = serde_json::to_value(&value).unwrap();
        assert_eq!(
            json,
            serde_json::json!({"assetId":"id", "displayName":"paper.pdf", "mimeType":"application/pdf"})
        );
        assert_eq!(serde_json::from_value::<NoteAsset>(json).unwrap(), value);
        assert!(
            serde_json::from_str::<ImportInput>(
                r#"{"displayName":"a","mimeType":"text/plain","byteSize":1,"bytes":[1]}"#
            )
            .is_err()
        );
    }

    #[test]
    fn original_resource_path_retains_uuid_spelling_and_rejects_traversal() {
        let id = "AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE";
        assert_eq!(
            crate::resource_path::writing_note_asset_path(id).unwrap(),
            format!(".ranote-assets/{id}")
        );
        assert!(crate::resource_path::writing_note_asset_path("../main.tex").is_err());
    }
}
