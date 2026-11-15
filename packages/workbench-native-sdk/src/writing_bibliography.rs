//! Owned inputs for the original bibliography entry projection.
pub mod adoption;
pub mod mutation;
pub mod rekey;
use crate::writing_project::{CitationBinding, ManuscriptFile};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, thiserror::Error)]
#[serde(
    tag = "kind",
    content = "cause",
    rename_all = "camelCase",
    deny_unknown_fields
)]
pub enum BibliographyError {
    #[error("稿件路径无效")]
    InvalidPath,
    #[error("Citation.js 必须提供单个有效 BibTeX entry")]
    InvalidBibtexEntry,
    #[error("BibTeX 导入未完成：{0}")]
    BibliographyImport(String),
}

pub use BibliographyError as EntryError;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CitationCandidate {
    pub literature_item_id: String,
    pub title: String,
    pub first_author: String,
    pub issued_year: Option<i32>,
    pub container_title: String,
    pub imported_key: String,
    pub citation_key: Option<String>,
    pub has_pdf: bool,
    pub has_evidence: bool,
    pub warnings: Vec<String>,
}

/// Original IPC input. Keep unknown-field tolerance and omitted optional keys.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BibliographyEntryInput {
    pub literature_item_id: String,
    pub requested_key: Option<String>,
    pub bibtex_entry: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectBibliographyEntry {
    pub id: String,
    pub manuscript_id: String,
    pub citation_key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_key: Option<String>,
    pub original_key: String,
    pub original_bibtex: String,
    pub bibtex_entry: String,
    pub imported: Value,
    pub current: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub library_item_id: Option<String>,
    #[serde(deserialize_with = "required_optional")]
    pub library_item: Option<Value>,
    pub paths: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImportedRecord {
    pub id: String,
    pub citation_key: String,
    pub original_key: String,
    pub original_bibtex: String,
    pub bibtex_entry: String,
    pub imported_json: String,
    #[serde(deserialize_with = "required_optional")]
    pub library_item_id: Option<String>,
}

/// Missing canonical metadata is consumed after the original related SQL/JSON.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreparedImported {
    pub manuscript_id: String,
    pub record: ImportedRecord,
    #[serde(deserialize_with = "required_optional")]
    pub current: Option<Value>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreparedAutomatic {
    pub manuscript_id: String,
    pub reference_id: String,
    pub binding: CitationBinding,
    pub metadata: Value,
    pub read_library: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum EntryInput {
    PrepareImported {
        manuscript_id: String,
        rows: Vec<ImportedRecord>,
        support: String,
    },
    FinishImported {
        entry: Box<PreparedImported>,
        imported: Value,
        paths: Vec<String>,
        #[serde(deserialize_with = "required_optional")]
        base_key: Option<String>,
        #[serde(deserialize_with = "required_optional")]
        library_item: Option<Value>,
    },
    PrepareAutomatic {
        manuscript_id: String,
        binding: Box<CitationBinding>,
        occupied_keys: Vec<String>,
    },
    FinishAutomatic {
        entry: Box<PreparedAutomatic>,
        #[serde(deserialize_with = "required_optional")]
        base_key: Option<String>,
        #[serde(deserialize_with = "required_optional")]
        library_item: Option<Value>,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum EntryDecision {
    ImportedPrepared {
        entries: Vec<PreparedImported>,
    },
    AutomaticPrepared {
        #[serde(deserialize_with = "required_optional")]
        entry: Option<Box<PreparedAutomatic>>,
    },
    Entry {
        entry: Box<ProjectBibliographyEntry>,
    },
    Rejected {
        reason: EntryError,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AutomaticProjection {
    pub imported_keys: Vec<String>,
    pub retained_keys: Vec<String>,
    pub bindings: Vec<CitationBinding>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SupplementalEntry {
    pub bibtex_entry: String,
    pub member_paths: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SupplementalProjection {
    pub entries: Vec<String>,
    pub support_paths: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PublicationFile {
    pub path: String,
    pub target: String,
    pub support: String,
    pub entries: Vec<String>,
    pub supplemental_entries: Vec<String>,
    pub supplemental_support: String,
    #[serde(deserialize_with = "required_optional")]
    pub automatic: Option<AutomaticProjection>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PublicationContent {
    pub content: String,
    pub sha256: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SourceStat {
    pub path: String,
    pub dev: u64,
    pub ino: u64,
    pub len: u64,
    pub mtime: i64,
    pub mtime_nsec: i64,
    pub ctime: i64,
    pub ctime_nsec: i64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum SourceStats {
    Unqueried,
    Missing,
    Ready { values: Vec<SourceStat> },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PublicationProof {
    pub root: String,
    pub files: Vec<ManuscriptFile>,
    pub rows: [Vec<Vec<Option<String>>>; 4],
    pub stats: SourceStats,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum RegenerationPlan {
    Unchanged,
    Conflict {
        #[serde(deserialize_with = "required_optional")]
        expected: Option<String>,
    },
    Register,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum LegacyRecoveryPlan {
    NeedIsFile {
        path: String,
    },
    NeedReferenceRead {
        path: String,
    },
    NeedExists {
        path: String,
    },
    Ready {
        force: bool,
        #[serde(deserialize_with = "required_optional")]
        user_path: Option<String>,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum FileComparison {
    Current,
    Conflict,
    Write {
        #[serde(deserialize_with = "required_optional")]
        expected: Option<String>,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum PublicationInput {
    Regeneration {
        target: String,
        previous: crate::writing_project::BibliographyStatus,
        bindings_empty: bool,
        supplemental_empty: bool,
        #[serde(deserialize_with = "required_optional")]
        original: Option<(String, String)>,
        force: bool,
    },
    LegacyRecovery {
        registered: bool,
        #[serde(deserialize_with = "required_optional")]
        reference_is_file: Option<bool>,
        reference_read: bool,
        probes: Vec<(String, bool)>,
    },
    Proof {
        input: Box<PublicationProof>,
    },
    Verify {
        expected: String,
        #[serde(deserialize_with = "required_optional")]
        actual_sha256: Option<String>,
    },
    Supplemental {
        declared: Vec<String>,
        registered: Vec<String>,
        entries: Vec<SupplementalEntry>,
    },
    SourcePaths {
        files: Vec<ManuscriptFile>,
        root_path: String,
    },
    Declarations {
        source: String,
        declared: Vec<String>,
    },
    Target {
        declared: Vec<String>,
        registered: Vec<String>,
    },
    Retention {
        #[serde(deserialize_with = "required_optional")]
        sources: Option<Vec<String>>,
        automatic: Vec<(String, String)>,
        imported: Vec<(String, String)>,
        preserve_imported: bool,
    },
    Content {
        file: Box<PublicationFile>,
    },
    Compare {
        previous: String,
        target_sha256: String,
        #[serde(deserialize_with = "required_optional")]
        actual_sha256: Option<String>,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum PublicationDecision {
    Regeneration {
        plan: RegenerationPlan,
    },
    LegacyRecovery {
        plan: LegacyRecoveryPlan,
    },
    NeedStats {
        paths: Vec<String>,
    },
    Proof {
        #[serde(deserialize_with = "required_optional")]
        fingerprint: Option<[u8; 32]>,
    },
    Verified {
        matches: bool,
    },
    Supplemental {
        projection: SupplementalProjection,
    },
    SourcePaths {
        paths: Vec<String>,
    },
    Declarations {
        declared: Vec<String>,
    },
    Target {
        declared: Vec<String>,
        target: String,
    },
    NeedSources,
    Retained {
        keys: Vec<String>,
    },
    NeedAutomatic,
    Content {
        content: PublicationContent,
    },
    Compared {
        result: FileComparison,
    },
    Rejected {
        reason: BibliographyError,
    },
}

fn required_optional<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::deserialize(deserializer)
}
