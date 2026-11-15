//! Finite original bibliography management decisions, without a writer.
use super::{BibliographyError, ProjectBibliographyEntry, required_optional};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize, thiserror::Error)]
#[serde(
    tag = "kind",
    content = "cause",
    rename_all = "camelCase",
    deny_unknown_fields
)]
pub enum Rejection {
    #[error("稿件信息无效")]
    InvalidManuscript,
    #[error(transparent)]
    Bibliography(#[from] BibliographyError),
    #[error("BibTeX 文件由参考文献管理器维护，不能直接编辑：{0}")]
    ManagedBibliography(String),
    #[error("文件已在其他位置被修改，请重新载入后再保存")]
    FileConflict,
    #[error("引用来源不存在或已移入回收站")]
    CitationSourceNotFound,
    #[error("文献引用服务不可用")]
    LiteratureUnavailable,
}
#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(
    tag = "phase",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum Input {
    PrepareSearch {
        scope: String,
        library_available: bool,
    },
    ProjectSearch {
        hits: Vec<crate::catalog::bibliography::CitationSearchHit>,
    },
    ValidateDraft {
        draft: Value,
    },
    SelectUpdate {
        entry_id: String,
        entries: Vec<ProjectBibliographyEntry>,
        draft: Value,
        library_available: bool,
    },
    Update {
        key: String,
        current: String,
        #[serde(deserialize_with = "required_optional")]
        linked: Option<String>,
        expected: String,
        selected: Value,
        patch: Map<String, Value>,
    },
    SelectLink {
        entry_id: String,
        item_id: String,
    },
    BindKey {
        #[serde(deserialize_with = "required_optional")]
        requested: Option<String>,
        #[serde(deserialize_with = "required_optional")]
        imported: Option<String>,
        #[serde(deserialize_with = "required_optional")]
        pinned: Option<String>,
        occupied: Vec<String>,
    },
    RemoveKeys {
        keys: Vec<String>,
        used: Vec<String>,
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
    SearchScope {
        project_only: bool,
    },
    Candidates {
        items: Vec<super::CitationCandidate>,
    },
    Accepted,
    UpdateSelection {
        selected: Value,
        patch: Map<String, Value>,
    },
    Text {
        text: String,
    },
    Link {
        #[serde(deserialize_with = "required_optional")]
        source: Option<String>,
    },
    Key {
        key: String,
    },
    Remove {
        keys: Vec<String>,
    },
    Rejected {
        reason: Rejection,
    },
}
