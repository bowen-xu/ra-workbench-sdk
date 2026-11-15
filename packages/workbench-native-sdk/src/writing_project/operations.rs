//! Finite owned inputs and decisions for the existing project/document chain.
use super::*;
use crate::data::DataRows;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, thiserror::Error)]
#[serde(rename_all = "camelCase")]
pub enum Rejection {
    #[error("研究项目不存在")]
    ProjectNotFound,
    #[error("稿件不存在")]
    ManuscriptNotFound,
    #[error("请先归档稿件，再永久删除")]
    ManuscriptMustBeArchived,
    #[error("稿件信息无效")]
    InvalidManuscript,
    #[error("稿件标识无效")]
    InvalidManuscriptId,
    #[error("稿件路径无效")]
    InvalidPath,
    #[error("写作文件检查点格式无效")]
    InvalidCheckpoint,
    #[error("写作文件检查点已变化，请重新核对当前版本")]
    CheckpointConflict,
    #[error("文本文件超过 8 MiB 限制")]
    FileTooLarge,
    #[error("该稿件已有编译任务正在运行")]
    CompileAlreadyRunning,
    #[error("BibTeX 文件由参考文献管理器维护，不能直接编辑：{0}")]
    ManagedBibliography(String),
    #[error("稿件文件不存在")]
    FileNotFound,
}

impl Rejection {
    pub fn code(&self) -> &'static str {
        match self {
            Self::ProjectNotFound | Self::ManuscriptNotFound | Self::FileNotFound => "not_found",
            Self::ManagedBibliography(_) => "managed_bibliography",
            Self::CompileAlreadyRunning => "compile_already_running",
            Self::CheckpointConflict => "checkpoint_conflict",
            Self::FileTooLarge => "file_too_large",
            Self::ManuscriptMustBeArchived
            | Self::InvalidManuscript
            | Self::InvalidManuscriptId
            | Self::InvalidPath
            | Self::InvalidCheckpoint => "invalid_input",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ProjectScope {
    Existing { project_id: String },
    Standalone { project_id: String },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Metadata {
    pub title: String,
    pub root_path: String,
}

/// Deferred until the original operation has checked its earlier SQL/file steps.
/// It cannot authorize a write before those steps and the read-set recheck.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum MetadataDecision {
    Ready { metadata: Metadata },
    Rejected { reason: Rejection },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InitialTemplate {
    pub kind: String,
    pub content: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecoveryRetention {
    pub per_manuscript: u64,
    pub total: u64,
}

/// Original persisted redo entry. Older records may contain additional fields.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CitationKeyWrite {
    pub path: String,
    pub previous: String,
    pub content: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CitationKeyRecovery {
    pub writes: Vec<CitationKeyWrite>,
    pub file_kind: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreationPlan {
    pub manuscript_id: String,
    pub scope: ProjectScope,
    pub metadata: MetadataDecision,
    #[serde(deserialize_with = "required_optional")]
    pub initial_template: Option<InitialTemplate>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Operation {
    PrepareAgentFileChanges,
    ListProjects,
    GetProject,
    PrepareStatus,
    FinishStatus,
    CheckRootKind,
    PrepareCreation,
    VerifyCreation,
    PrepareUpdate,
    PrepareDeletion,
    VerifyDeletion,
    ListFiles,
    GetSession,
    PrepareSession,
    ListRecoveryDrafts,
    PrepareRecoveryDraft,
    ProjectRecoveryDraft,
    PrepareRecoveryClear,
    PrepareFileRecovery,
    PrepareFileSave,
    FinishFileSave,
    PrepareFileChange,
    PlanFileChange,
    Directory,
    CatalogPreparation,
    CatalogQuery,
    Checkpoint,
    Context,
    CitationMetadata,
    HostFiles,
    BibliographyEntries,
    BibliographyPublication,
    BibliographyAdoption,
    BibliographyRekey,
    BibliographyMutation,
    Compile,
    Transfer,
    NoteAsset,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum Input {
    NoteAsset {
        input: crate::writing_note_asset::ImportInput,
    },
    Transfer {
        input: Box<crate::writing_transfer::Input>,
    },
    PrepareAgentFileChanges {
        relative_paths: Vec<String>,
    },
    Compile {
        input: Box<crate::writing_compile::Input>,
    },
    BibliographyMutation {
        input: Box<crate::writing_bibliography::mutation::Input>,
    },
    BibliographyRekey {
        input: Box<crate::writing_bibliography::rekey::Input>,
    },
    BibliographyAdoption {
        input: Box<crate::writing_bibliography::adoption::AdoptionInput>,
    },
    BibliographyPublication {
        input: Box<crate::writing_bibliography::PublicationInput>,
    },
    BibliographyEntries {
        input: Box<crate::writing_bibliography::EntryInput>,
    },
    HostFiles {
        manuscript_id: String,
        rows: DataRows,
    },
    CitationMetadata {
        metadata_kind: CitationMetadataKind,
        manuscript_id: String,
        manuscript: DataRows,
        #[serde(deserialize_with = "required_optional")]
        data: Option<DataRows>,
    },
    Context {
        input: Box<crate::writing_context::ContextInput>,
    },
    Checkpoint {
        input: Box<crate::writing_checkpoint::CheckpointInput>,
    },
    CatalogQuery {
        input: Box<crate::writing_catalog_query::QueryInput>,
    },
    CatalogPreparation {
        input: Box<crate::writing_catalog::CatalogInput>,
    },
    Directory {
        input: Box<crate::writing_directory::DirectoryInput>,
    },
    PrepareFileChange {
        request: crate::writing_file::FileChangeRequest,
    },
    PlanFileChange {
        request: crate::writing_file::FileChangeRequest,
        manuscript: DataRows,
    },
    ListProjects {
        rows: DataRows,
    },
    GetProject {
        manuscript_id: String,
        rows: DataRows,
    },
    PrepareStatus {
        manuscript_id: String,
    },
    FinishStatus {
        manuscript_id: String,
        affected_rows: u64,
        #[serde(deserialize_with = "required_optional")]
        manuscript: Option<DataRows>,
    },
    CheckRootKind {
        relative_path: String,
    },
    PrepareCreation {
        manuscript_id: String,
        draft: ManuscriptDraft,
    },
    VerifyCreation {
        plan: CreationPlan,
        project_exists: DataRows,
    },
    PrepareUpdate {
        request: UpdateManuscriptRequest,
        manuscript: DataRows,
    },
    PrepareDeletion {
        manuscript_id: String,
        manuscript: DataRows,
    },
    VerifyDeletion {
        manuscript_id: String,
        active_compile: DataRows,
    },
    ListFiles {
        manuscript_id: String,
        manuscript: DataRows,
        #[serde(deserialize_with = "required_optional")]
        files: Option<DataRows>,
    },
    GetSession {
        manuscript_id: String,
        manuscript: DataRows,
        #[serde(deserialize_with = "required_optional")]
        session: Option<DataRows>,
    },
    PrepareSession {
        draft: WritingSessionDraft,
    },
    ListRecoveryDrafts {
        manuscript_id: String,
        manuscript: DataRows,
        #[serde(deserialize_with = "required_optional")]
        drafts: Option<DataRows>,
    },
    PrepareRecoveryDraft {
        draft: RecoveryDraftInput,
        manuscript: DataRows,
    },
    ProjectRecoveryDraft {
        manuscript_id: String,
        relative_path: String,
        rows: DataRows,
    },
    PrepareRecoveryClear {
        manuscript_id: String,
        relative_path: String,
    },
    PrepareFileRecovery {
        manuscript_id: String,
        pending: DataRows,
    },
    PrepareFileSave {
        request: SaveFileRequest,
        note_title: String,
    },
    FinishFileSave {
        preparation: Box<crate::writing_file::FileSavePreparation>,
        manuscript: DataRows,
        #[serde(deserialize_with = "required_optional")]
        note_analysis: Option<Box<crate::note_document::NoteDocumentAnalysis>>,
    },
}

impl Input {
    pub fn operation(&self) -> Operation {
        match self {
            Self::NoteAsset { .. } => Operation::NoteAsset,
            Self::Transfer { .. } => Operation::Transfer,
            Self::PrepareAgentFileChanges { .. } => Operation::PrepareAgentFileChanges,
            Self::Compile { .. } => Operation::Compile,
            Self::BibliographyMutation { .. } => Operation::BibliographyMutation,
            Self::BibliographyRekey { .. } => Operation::BibliographyRekey,
            Self::BibliographyAdoption { .. } => Operation::BibliographyAdoption,
            Self::BibliographyPublication { .. } => Operation::BibliographyPublication,
            Self::BibliographyEntries { .. } => Operation::BibliographyEntries,
            Self::HostFiles { .. } => Operation::HostFiles,
            Self::CitationMetadata { .. } => Operation::CitationMetadata,
            Self::Context { .. } => Operation::Context,
            Self::Checkpoint { .. } => Operation::Checkpoint,
            Self::CatalogQuery { .. } => Operation::CatalogQuery,
            Self::Directory { .. } => Operation::Directory,
            Self::CatalogPreparation { .. } => Operation::CatalogPreparation,
            Self::PrepareFileChange { .. } => Operation::PrepareFileChange,
            Self::PlanFileChange { .. } => Operation::PlanFileChange,
            Self::ListProjects { .. } => Operation::ListProjects,
            Self::GetProject { .. } => Operation::GetProject,
            Self::PrepareStatus { .. } => Operation::PrepareStatus,
            Self::FinishStatus { .. } => Operation::FinishStatus,
            Self::CheckRootKind { .. } => Operation::CheckRootKind,
            Self::PrepareCreation { .. } => Operation::PrepareCreation,
            Self::VerifyCreation { .. } => Operation::VerifyCreation,
            Self::PrepareUpdate { .. } => Operation::PrepareUpdate,
            Self::PrepareDeletion { .. } => Operation::PrepareDeletion,
            Self::VerifyDeletion { .. } => Operation::VerifyDeletion,
            Self::ListFiles { .. } => Operation::ListFiles,
            Self::GetSession { .. } => Operation::GetSession,
            Self::PrepareSession { .. } => Operation::PrepareSession,
            Self::ListRecoveryDrafts { .. } => Operation::ListRecoveryDrafts,
            Self::PrepareRecoveryDraft { .. } => Operation::PrepareRecoveryDraft,
            Self::ProjectRecoveryDraft { .. } => Operation::ProjectRecoveryDraft,
            Self::PrepareRecoveryClear { .. } => Operation::PrepareRecoveryClear,
            Self::PrepareFileRecovery { .. } => Operation::PrepareFileRecovery,
            Self::PrepareFileSave { .. } => Operation::PrepareFileSave,
            Self::FinishFileSave { .. } => Operation::FinishFileSave,
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
pub enum Decision {
    NoteAsset {
        decision: crate::writing_note_asset::Decision,
    },
    Transfer {
        decision: Box<crate::writing_transfer::Decision>,
    },
    AgentFileChangesPrepared {
        policies: Vec<crate::writing_file::AgentFilePolicy>,
    },
    Compile {
        decision: Box<crate::writing_compile::Decision>,
    },
    BibliographyMutation {
        decision: Box<crate::writing_bibliography::mutation::Decision>,
    },
    BibliographyRekey {
        decision: Box<crate::writing_bibliography::rekey::Decision>,
    },
    BibliographyAdoption {
        decision: Box<crate::writing_bibliography::adoption::AdoptionDecision>,
    },
    BibliographyPublication {
        decision: Box<crate::writing_bibliography::PublicationDecision>,
    },
    BibliographyEntries {
        decision: Box<crate::writing_bibliography::EntryDecision>,
    },
    HostFiles {
        items: Vec<HostResourceFile>,
    },
    CitationBindings {
        items: Vec<CitationBinding>,
    },
    BibliographyStatus {
        status: BibliographyStatus,
    },
    Context {
        decision: Box<crate::writing_context::ContextDecision>,
    },
    Checkpoint {
        decision: Box<crate::writing_checkpoint::CheckpointDecision>,
    },
    CatalogQuery {
        decision: Box<crate::writing_catalog_query::QueryDecision>,
    },
    CatalogPreparation {
        decision: Box<crate::writing_catalog::CatalogDecision>,
    },
    Directory {
        decision: Box<crate::writing_directory::DirectoryDecision>,
    },
    FileChangePrepared {
        request: crate::writing_file::FileChangeRequest,
    },
    FileChange {
        plan: Box<crate::writing_file::FileChangePlan>,
    },
    FileSavePrepared {
        preparation: Box<crate::writing_file::FileSavePreparation>,
    },
    FileSave {
        plan: Box<crate::writing_file::FileSavePlan>,
    },
    FileRecovery {
        manuscript_id: String,
        #[serde(deserialize_with = "required_optional")]
        recovery: Option<CitationKeyRecovery>,
    },
    StatusPrepared {
        manuscript_id: String,
    },
    RootKindAccepted {
        relative_path: String,
    },
    Projects {
        items: Vec<Manuscript>,
    },
    Project {
        manuscript: Manuscript,
    },
    Creation {
        plan: CreationPlan,
    },
    Metadata {
        manuscript_id: String,
        decision: MetadataDecision,
    },
    Deletion {
        manuscript_id: String,
    },
    DeletionNeedsCompileCheck {
        manuscript_id: String,
    },
    Files {
        files: Vec<ManuscriptFile>,
    },
    Session {
        #[serde(deserialize_with = "required_optional")]
        session: Option<WritingSession>,
    },
    SessionPrepared {
        draft: WritingSessionDraft,
    },
    RecoveryDrafts {
        drafts: Vec<RecoveryDraft>,
    },
    RecoveryDraftPrepared {
        draft: RecoveryDraftInput,
        retention: RecoveryRetention,
    },
    RecoveryDraft {
        draft: RecoveryDraft,
    },
    RecoveryClearPrepared {
        manuscript_id: String,
        relative_path: String,
    },
    Rejected {
        reason: Rejection,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Output {
    pub input: Input,
    pub decision: Decision,
}

fn required_optional<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::deserialize(deserializer)
}
