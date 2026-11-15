//! Closed owned observations for the original directory preflight and relation tx.
use crate::{
    data::DataRows,
    writing_project::{Manuscript, Metadata, Rejection, WritingSessionDraft},
};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum DirectoryRequest {
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
impl DirectoryRequest {
    pub fn manuscript_id(&self) -> &str {
        match self {
            Self::Rename { manuscript_id, .. } | Self::Delete { manuscript_id, .. } => {
                manuscript_id
            }
        }
    }
    pub fn source(&self) -> &str {
        match self {
            Self::Rename { from_path, .. } => from_path,
            Self::Delete { relative_path, .. } => relative_path,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum DirectoryRejection {
    Domain { reason: Rejection },
    StoredJson { message: String },
    InputInvalid { message: String },
}
impl DirectoryRejection {
    pub fn code(&self) -> &'static str {
        match self {
            Self::Domain { reason } => reason.code(),
            Self::StoredJson { .. } => "storage_error",
            Self::InputInvalid { .. } => "plugin_host_input_invalid",
        }
    }
}
impl std::fmt::Display for DirectoryRejection {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Domain { reason } => reason.fmt(f),
            Self::StoredJson { message } | Self::InputInvalid { message } => message.fmt(f),
        }
    }
}

/// Unavailable is a private Core SQL failure, consumed at its original stage.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "camelCase", deny_unknown_fields)]
pub enum DirectoryStage<T> {
    Unavailable,
    Rejected { reason: DirectoryRejection },
    Ready { value: T },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "phase",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum DirectoryInput {
    Preflight {
        request: DirectoryRequest,
        #[serde(deserialize_with = "required_optional")]
        manuscript: Option<DataRows>,
        #[serde(deserialize_with = "required_optional")]
        files: Option<DataRows>,
    },
    Relations {
        request: DirectoryRequest,
        #[serde(deserialize_with = "required_optional")]
        manuscript: Option<DataRows>,
        #[serde(deserialize_with = "required_optional")]
        files: Option<DataRows>,
        #[serde(deserialize_with = "required_optional")]
        drafts: Option<DataRows>,
        #[serde(deserialize_with = "required_optional")]
        session: Option<DataRows>,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DirectoryPathChange {
    pub path: String,
    #[serde(deserialize_with = "required_optional")]
    pub target: Option<String>,
    #[serde(deserialize_with = "required_optional")]
    pub rejection: Option<Rejection>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DirectoryPlan {
    pub paths: DirectoryStage<()>,
    pub manuscript: DirectoryStage<Manuscript>,
    pub files: DirectoryStage<Vec<DirectoryPathChange>>,
    pub drafts: DirectoryStage<Vec<DirectoryPathChange>>,
    pub session: DirectoryStage<Option<WritingSessionDraft>>,
    pub metadata: DirectoryStage<Option<Metadata>>,
    pub on_unindexed_file: Rejection,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "phase",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum DirectoryDecision {
    Preflight {
        manuscript: DirectoryStage<()>,
        files: DirectoryStage<()>,
    },
    Relations {
        plan: Box<DirectoryPlan>,
    },
}

fn required_optional<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::deserialize(deserializer)
}
