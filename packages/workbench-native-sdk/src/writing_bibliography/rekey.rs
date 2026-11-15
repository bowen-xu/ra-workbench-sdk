//! Owned facts for the original citation-key migration, without a writer.
use super::{BibliographyError, ProjectBibliographyEntry, required_optional};
use crate::{
    writing_checkpoint::{CheckpointRecord, DocumentCheckpoint},
    writing_project::{ManuscriptFileContent, Rejection as ProjectRejection},
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Assignment {
    pub reference_id: String,
    pub base_key: String,
    pub from: String,
    pub to: String,
}

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Migration {
    pub assignments: Vec<Assignment>,
    pub files: Vec<ManuscriptFileContent>,
    pub checkpoints: Vec<CheckpointRecord>,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize, thiserror::Error)]
#[serde(
    tag = "kind",
    content = "cause",
    rename_all = "camelCase",
    deny_unknown_fields
)]
pub enum Rejection {
    #[error(transparent)]
    Bibliography(#[from] BibliographyError),
    #[error(transparent)]
    Project(#[from] ProjectRejection),
    #[error("引用来源不存在或已移入回收站")]
    CitationSourceNotFound,
}

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(
    tag = "phase",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum Input {
    Mapping {
        assignments: Vec<Assignment>,
        entries: Vec<ProjectBibliographyEntry>,
    },
    Source {
        source: String,
        mapping: BTreeMap<String, String>,
    },
    Checkpoint {
        manuscript_id: String,
        relative_path: String,
        text: String,
        actual_sha256: String,
        next: String,
        mapping: BTreeMap<String, String>,
        #[serde(deserialize_with = "required_optional")]
        record: Option<Box<CheckpointRecord>>,
    },
    TemporaryOwners {
        keys: Vec<(String, String)>,
        mapping: BTreeMap<String, String>,
    },
    Canonical {
        key: String,
        source: String,
        mapping: BTreeMap<String, String>,
    },
}

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum Decision {
    Mapping {
        mapping: BTreeMap<String, String>,
    },
    Source {
        text: String,
    },
    Checkpoint {
        #[serde(deserialize_with = "required_optional")]
        checkpoint: Option<Box<DocumentCheckpoint>>,
    },
    TemporaryOwners {
        owners: Vec<String>,
    },
    Canonical {
        key: String,
        text: String,
    },
    Rejected {
        reason: Rejection,
    },
}
