//! Finite request variants and their original operation mapping.
use super::{
    CatalogOperation, CatalogProjectionInput, CatalogRequest, CatalogSelectionRows, bibliography,
};
use crate::data::DataRows;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum CatalogInput {
    PreparePaperConfirmation {
        input: Box<crate::paper_confirmation::wire::PaperConfirmationWireInputV1>,
    },
    ProjectReadingHistory {
        input: Box<crate::reading_history::ReadingHistoryInputV1>,
    },
    PrepareBrowserCapture {
        input: Box<crate::browser_capture::BrowserCaptureInputV1>,
    },
    DecideAnalysisWorkflow {
        input: Box<crate::analysis_workflow::wire::WorkflowWireInputV1>,
    },
    ProjectAnalysisHistory {
        input: Box<crate::analysis_history::HistoryWireInputV1>,
    },
    BibliographySearch {
        input: Box<bibliography::SearchInput>,
    },
    PlanBibliographyCandidates {
        input: Box<bibliography::CandidatesInput>,
    },
    Plan {
        request: CatalogRequest,
    },
    Select {
        selection: CatalogSelectionRows,
    },
    Project {
        input: CatalogProjectionInput,
    },
    PrepareSave {
        input: Box<crate::catalog_save::CatalogSaveInput>,
    },
    ReadNalQueries {
        row: crate::nal_query::StoredRow,
    },
    PrepareNalQuerySave {
        content: crate::nal_query::SavePlan,
    },
    PrepareNalBootstrapProbes {
        source: Box<crate::nal_bootstrap::BootstrapSourceV1>,
    },
    PrepareNalBootstrap {
        input: Box<crate::nal_bootstrap::BootstrapInputV1>,
    },
    ValidateNalAnnotation {
        request: crate::nal_annotation::NalAnnotationRequest,
    },
    PrepareNalAnnotation {
        input: Box<crate::nal_annotation_prepare::NalAnnotationPrepareInput>,
    },
    PrepareNalMutation {
        input: Box<crate::nal_mutation::NalMutationPrepareInput>,
    },
    ProjectDuplicateCandidates {
        rows: DataRows,
    },
    ProjectMergeOperations {
        rows: DataRows,
    },
    PrepareDuplicateDecision {
        request: crate::duplicate_review::DuplicateDecisionRequestV1,
    },
    FinishDuplicateDecision {
        input: crate::duplicate_review::FinishDuplicateDecisionInputV1,
    },
    PrepareDuplicateUndo {
        input: crate::duplicate_undo::UndoMergePrepareInputV1,
    },
    PrepareDuplicateMerge {
        input: Box<crate::duplicate_merge_prepare::MergePrepareInputV1>,
    },
    PrepareLiteratureLifecycle {
        request: crate::literature_lifecycle::LifecycleRequestV1,
    },
    PrepareTrashCleanup {},
    PrepareMetadata {
        input: Box<crate::metadata::MetadataInputV1>,
    },
    PrepareBibtex {
        input: crate::import_jobs::PrepareBibtexInputV1,
    },
    ProjectImportJobs {
        input: crate::import_jobs::ImportJobsProjectionInputV1,
    },
    DoiPreview {
        input: Box<crate::doi_metadata::DoiPreviewInputV1>,
    },
    ValidateEvidenceWrite {
        input: Box<crate::evidence_write::EvidenceWriteInputV1>,
    },
    DecideDerivedView {
        input: Box<crate::derived_view::manual::DerivedViewInputV1>,
    },
    ValidateEvidenceMatrix {
        input: Box<crate::evidence_matrix::MatrixValidationInputV1>,
    },
    PrepareReferenceRecord {
        input: Box<crate::reference_records::ReferenceRecordPrepareInputV1>,
    },
    PrepareLiteratureAttachment {
        input: Box<crate::attachments::AttachmentPrepareInputV1>,
    },
    PreparePdfImportHeader {
        candidates: Vec<crate::pdf_import::PdfImportCandidate>,
    },
    DecodePdfImportCandidate {
        raw_input: String,
    },
    PrepareResearchConcept {
        input: Box<crate::concepts::ConceptRequestV1>,
    },
    PrepareReadingUnit {
        input: Box<crate::reading_units::ReadingUnitRequestV1>,
    },
    ValidateStructured {
        input: Box<crate::structured_validation::StructuredValidationInputV1>,
    },
    SelectUnreviewedFields {
        input: Box<crate::review_selection::UnreviewedSelectionInputV1>,
    },
    ValidateEditableTemplate {
        input: Box<crate::editable_template::EditableTemplateInputV1>,
    },
    PreparePaperContext {
        input: Box<crate::paper_context_wire::PaperContextInputV1>,
    },
    DecidePaperRetrievalTrace {
        input: Box<crate::paper_retrieval::PaperRetrievalInputV1>,
    },
    PrepareSemanticIndex {
        input: Box<crate::semantic_index::rules::IndexWireInputV1>,
    },
    PrepareConceptRetrieval {
        input: Box<crate::concept_retrieval::ConceptRetrievalWireInputV1>,
    },
    ProjectContextMetadata {
        input: Box<crate::context_metadata::ContextMetadataRequestV1>,
    },
}

impl CatalogInput {
    pub fn operation(&self) -> CatalogOperation {
        match self {
            Self::PreparePaperConfirmation { .. } => CatalogOperation::PreparePaperConfirmation,
            Self::PrepareBrowserCapture { .. } => CatalogOperation::PrepareBrowserCapture,
            Self::ProjectReadingHistory { .. } => CatalogOperation::ProjectReadingHistory,
            Self::DecideAnalysisWorkflow { .. } => CatalogOperation::DecideAnalysisWorkflow,
            Self::ProjectAnalysisHistory { .. } => CatalogOperation::ProjectAnalysisHistory,
            Self::PlanBibliographyCandidates { .. } => CatalogOperation::PlanBibliographyCandidates,
            Self::BibliographySearch { .. } => CatalogOperation::BibliographySearch,
            Self::Plan { .. } => CatalogOperation::Plan,
            Self::Select { .. } => CatalogOperation::Select,
            Self::Project { .. } => CatalogOperation::Project,
            Self::PrepareSave { .. } => CatalogOperation::PrepareSave,
            Self::ReadNalQueries { .. } => CatalogOperation::ReadNalQueries,
            Self::PrepareNalQuerySave { .. } => CatalogOperation::PrepareNalQuerySave,
            Self::PrepareNalBootstrapProbes { .. } => CatalogOperation::PrepareNalBootstrapProbes,
            Self::PrepareNalBootstrap { .. } => CatalogOperation::PrepareNalBootstrap,
            Self::ValidateNalAnnotation { .. } => CatalogOperation::ValidateNalAnnotation,
            Self::PrepareNalAnnotation { .. } => CatalogOperation::PrepareNalAnnotation,
            Self::PrepareNalMutation { .. } => CatalogOperation::PrepareNalMutation,
            Self::ProjectDuplicateCandidates { .. } => CatalogOperation::ProjectDuplicateCandidates,
            Self::ProjectMergeOperations { .. } => CatalogOperation::ProjectMergeOperations,
            Self::PrepareDuplicateDecision { .. } => CatalogOperation::PrepareDuplicateDecision,
            Self::FinishDuplicateDecision { .. } => CatalogOperation::FinishDuplicateDecision,
            Self::PrepareDuplicateUndo { .. } => CatalogOperation::PrepareDuplicateUndo,
            Self::PrepareDuplicateMerge { .. } => CatalogOperation::PrepareDuplicateMerge,
            Self::PrepareLiteratureLifecycle { .. } => CatalogOperation::PrepareLiteratureLifecycle,
            Self::PrepareTrashCleanup {} => CatalogOperation::PrepareTrashCleanup,
            Self::PrepareMetadata { .. } => CatalogOperation::PrepareMetadata,
            Self::PrepareBibtex { .. } => CatalogOperation::PrepareBibtex,
            Self::ProjectImportJobs { .. } => CatalogOperation::ProjectImportJobs,
            Self::DoiPreview { .. } => CatalogOperation::DoiPreview,
            Self::ValidateEvidenceWrite { .. } => CatalogOperation::ValidateEvidenceWrite,
            Self::DecideDerivedView { .. } => CatalogOperation::DecideDerivedView,
            Self::ValidateEvidenceMatrix { .. } => CatalogOperation::ValidateEvidenceMatrix,
            Self::PrepareReferenceRecord { .. } => CatalogOperation::PrepareReferenceRecord,
            Self::PrepareLiteratureAttachment { .. } => {
                CatalogOperation::PrepareLiteratureAttachment
            }
            Self::PreparePdfImportHeader { .. } => CatalogOperation::PreparePdfImportHeader,
            Self::DecodePdfImportCandidate { .. } => CatalogOperation::DecodePdfImportCandidate,
            Self::PrepareResearchConcept { .. } => CatalogOperation::PrepareResearchConcept,
            Self::PrepareReadingUnit { .. } => CatalogOperation::PrepareReadingUnit,
            Self::ValidateStructured { .. } => CatalogOperation::ValidateStructured,
            Self::SelectUnreviewedFields { .. } => CatalogOperation::SelectUnreviewedFields,
            Self::ValidateEditableTemplate { .. } => CatalogOperation::ValidateEditableTemplate,
            Self::PreparePaperContext { .. } => CatalogOperation::PreparePaperContext,
            Self::DecidePaperRetrievalTrace { .. } => CatalogOperation::DecidePaperRetrievalTrace,
            Self::PrepareSemanticIndex { .. } => CatalogOperation::PrepareSemanticIndex,
            Self::PrepareConceptRetrieval { .. } => CatalogOperation::PrepareConceptRetrieval,
            Self::ProjectContextMetadata { .. } => CatalogOperation::ProjectContextMetadata,
        }
    }
}
