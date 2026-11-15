//! Finite preparation for the original file-save and writing-note catalog chain.
use crate::{note_document::NoteDocument, writing_project::SaveFileRequest};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreparedWritingNote {
    pub note_id: String,
    pub document: NoteDocument,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum WritingNotePreparation {
    Ignored,
    Invalid { cause: String },
    Document { note: PreparedWritingNote },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FileSavePreparation {
    pub request: SaveFileRequest,
    pub file_kind: String,
    pub note: WritingNotePreparation,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum WritingNoteCatalogProjection {
    Ignored,
    Invalid {
        cause: String,
    },
    Ready {
        note_id: String,
        text: String,
        folded_text: String,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FileSavePlan {
    pub preparation: FileSavePreparation,
    pub catalog: WritingNoteCatalogProjection,
    pub duplicate_identity_cause: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum FileChangeRequest {
    Rename {
        manuscript_id: String,
        from_path: String,
        to_path: String,
    },
    Delete {
        manuscript_id: String,
        relative_path: String,
    },
}

impl FileChangeRequest {
    pub fn manuscript_id(&self) -> &str {
        match self {
            Self::Rename { manuscript_id, .. } | Self::Delete { manuscript_id, .. } => {
                manuscript_id
            }
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum FileChangeAction {
    Rename {
        touch_destination: bool,
        on_unindexed: crate::writing_project::Rejection,
        #[serde(deserialize_with = "required_optional")]
        root_metadata: Option<crate::writing_project::MetadataDecision>,
    },
    Delete,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FileChangePlan {
    pub request: FileChangeRequest,
    pub manuscript: crate::writing_project::Manuscript,
    pub action: FileChangeAction,
}

fn required_optional<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::deserialize(deserializer)
}

/// Original per-path decisions for Agent file application and index ACK.
/// Core retains physical validation, byte limits, SQL and transaction ownership.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentFilePolicy {
    pub relative_path: String,
    pub file_kind: String,
    pub editable: bool,
}

/// Package-owned classification data. The lookup preserves the original native
/// Path extension and ASCII case rules; the SDK supplies no extension choices.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FileKindPolicyV1 {
    pub format_version: u32,
    pub kinds: std::collections::BTreeMap<String, String>,
    pub text_kinds: Vec<String>,
    pub fallback_kind: String,
}

impl FileKindPolicyV1 {
    pub fn kind(&self, relative_path: &str) -> &str {
        let extension = std::path::Path::new(relative_path)
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        self.kinds
            .get(&extension)
            .map(String::as_str)
            .unwrap_or(&self.fallback_kind)
    }

    pub fn is_text_path(&self, relative_path: &str) -> bool {
        let kind = self.kind(relative_path);
        self.text_kinds.iter().any(|value| value == kind)
    }
}

#[cfg(test)]
mod file_kind_policy_tests {
    use super::FileKindPolicyV1;

    #[test]
    fn lookup_is_driven_only_by_the_supplied_package_data() {
        let policy: FileKindPolicyV1 = serde_json::from_value(serde_json::json!({
            "formatVersion": 1, "kinds": {"example": "editable"},
            "textKinds": ["editable"], "fallbackKind": "unknown"
        }))
        .unwrap();
        assert!(policy.is_text_path("nested/File.EXAMPLE"));
        for path in [
            "main.tex",
            "refs.bib",
            "file.example/child",
            ".example",
            "file.example.",
        ] {
            assert_eq!(policy.kind(path), "unknown", "{path}");
            assert!(!policy.is_text_path(path), "{path}");
        }
        let value = serde_json::to_value(&policy).unwrap();
        assert_eq!(
            serde_json::from_value::<FileKindPolicyV1>(value.clone()).unwrap(),
            policy
        );
        let mut extra = value;
        extra["extra"] = true.into();
        assert!(serde_json::from_value::<FileKindPolicyV1>(extra).is_err());
    }
}
