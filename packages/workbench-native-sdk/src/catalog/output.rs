//! Finite response variants and their original operation mapping.
use super::{CatalogOperation, CatalogProjectionOutcome, CatalogQueryPlan, bibliography};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum CatalogOutput {
    PaperConfirmation {
        outcome: Box<crate::paper_confirmation::wire::PaperConfirmationWireOutcomeV1>,
    },
    ReadingHistory {
        input: Box<crate::reading_history::ReadingHistoryInputV1>,
        decision: Box<crate::reading_history::ReadingHistoryDecisionV1>,
    },
    BrowserCapture {
        input: Box<crate::browser_capture::BrowserCaptureInputV1>,
        preparation: Box<crate::browser_capture::BrowserCapturePreparationV1>,
    },
    AnalysisWorkflow {
        outcome: Box<crate::analysis_workflow::wire::WorkflowWireOutcomeV1>,
    },
    AnalysisHistory {
        outcome: Box<crate::analysis_history::HistoryWireOutcomeV1>,
    },
    BibliographySearch {
        decision: bibliography::SearchDecision,
    },
    BibliographyCandidates {
        plan: bibliography::CandidatesPlan,
    },
    Plan {
        plan: CatalogQueryPlan,
    },
    Selection {
        ids: Vec<String>,
    },
    Projection {
        outcome: CatalogProjectionOutcome,
    },
    SavePlan {
        outcome: crate::catalog_save::CatalogSaveOutcome,
    },
    NalQueries {
        outcome: crate::nal_query::ProjectionOutcome,
    },
    NalQuerySavePlan {
        outcome: crate::nal_query::PrepareOutcome,
    },
    NalBootstrapProbes {
        outcome: Box<crate::nal_bootstrap::BootstrapProbePreparationV1>,
    },
    NalBootstrapPlan {
        outcome: Box<crate::nal_bootstrap::BootstrapPreparationV1>,
    },
    NalAnnotationValidation {
        outcome: crate::nal_annotation_prepare::NalAnnotationValidation,
    },
    NalAnnotationPreparation {
        outcome: Box<crate::nal_annotation_prepare::NalAnnotationPreparation>,
    },
    NalMutationPreparation {
        outcome: Box<crate::nal_mutation::NalMutationPreparation>,
    },
    DuplicateCandidates {
        items: Vec<crate::duplicate_review::DuplicateCandidateBitsV1>,
    },
    MergeOperations {
        items: Vec<crate::duplicate_review::MergeOperation>,
    },
    DuplicateDecisionPreparation {
        outcome: crate::duplicate_review::DuplicateDecisionPreparationV1,
    },
    DuplicateDecisionCompletion {
        outcome: crate::duplicate_review::DuplicateDecisionCompletionV1,
    },
    DuplicateUndoPreparation {
        outcome: Box<crate::duplicate_undo::PreparedDuplicateUndoV1>,
    },
    DuplicateMergePreparation {
        outcome: Box<crate::duplicate_merge_prepare::MergePreparationV1>,
    },
    LiteratureLifecyclePreparation {
        outcome: crate::literature_lifecycle::LifecyclePreparationV1,
    },
    TrashCleanupPreparation {
        outcome: crate::trash_cleanup::TrashCleanupPreparationV1,
    },
    MetadataPreparation {
        outcome: crate::metadata::MetadataPreparationV1,
    },
    BibtexPreparation {
        outcome: crate::import_jobs::BibtexPreparationV1,
    },
    ImportJobsProjection {
        outcome: crate::import_jobs::ImportJobsProjectionOutcomeV1,
    },
    DoiPreview {
        outcome: Box<crate::doi_metadata::DoiPreviewOutcomeV1>,
    },
    EvidenceWriteDecision {
        decision: crate::evidence_write::EvidenceWriteDecisionV1,
    },
    DerivedViewDecision {
        decision: crate::derived_view::manual::DerivedViewDecisionV1,
    },
    EvidenceMatrixValidation {
        decision: crate::evidence_matrix::MatrixValidationDecisionV1,
    },
    ReferenceRecordPreparation {
        outcome: Box<crate::reference_records::ReferenceRecordPreparationV1>,
    },
    LiteratureAttachmentPreparation {
        outcome: Box<crate::attachments::AttachmentPreparationV1>,
    },
    PdfImportHeaderPreparation {
        outcome: Box<crate::pdf_import::PdfImportHeaderPreparationV1>,
    },
    PdfImportCandidateDecoded {
        outcome: Box<crate::pdf_import::DecodedPdfImportCandidateV1>,
    },
    ResearchConceptPreparation {
        outcome: Box<crate::concepts::ConceptPreparationV1>,
    },
    ReadingUnitPreparation {
        outcome: Box<crate::reading_units::ReadingUnitPreparationV1>,
    },
    StructuredValidation {
        outcome: Box<crate::structured_validation::StructuredValidationOutcomeV1>,
    },
    UnreviewedFields {
        selection: Box<crate::review_selection::UnreviewedSelectionV1>,
    },
    EditableTemplate {
        outcome: Box<crate::editable_template::EditableTemplateOutcomeV1>,
    },
    PaperContext {
        outcome: Box<crate::paper_context_wire::PaperContextOutcomeV1>,
    },
    PaperRetrievalTrace {
        outcome: Box<crate::paper_retrieval::PaperRetrievalOutcomeV1>,
    },
    SemanticIndex {
        outcome: Box<crate::semantic_index::rules::IndexWireOutcomeV1>,
    },
    ConceptRetrieval {
        outcome: Box<crate::concept_retrieval::ConceptRetrievalWireOutcomeV1>,
    },
    ContextMetadata {
        outcome: Box<crate::context_metadata::ContextMetadataOutcomeV1>,
    },
}

impl CatalogOutput {
    pub fn operation(&self) -> CatalogOperation {
        match self {
            Self::PaperConfirmation { .. } => CatalogOperation::PreparePaperConfirmation,
            Self::BrowserCapture { .. } => CatalogOperation::PrepareBrowserCapture,
            Self::ReadingHistory { .. } => CatalogOperation::ProjectReadingHistory,
            Self::AnalysisWorkflow { .. } => CatalogOperation::DecideAnalysisWorkflow,
            Self::AnalysisHistory { .. } => CatalogOperation::ProjectAnalysisHistory,
            Self::BibliographyCandidates { .. } => CatalogOperation::PlanBibliographyCandidates,
            Self::BibliographySearch { .. } => CatalogOperation::BibliographySearch,
            Self::Plan { .. } => CatalogOperation::Plan,
            Self::Selection { .. } => CatalogOperation::Select,
            Self::Projection { .. } => CatalogOperation::Project,
            Self::SavePlan { .. } => CatalogOperation::PrepareSave,
            Self::NalQueries { .. } => CatalogOperation::ReadNalQueries,
            Self::NalQuerySavePlan { .. } => CatalogOperation::PrepareNalQuerySave,
            Self::NalBootstrapProbes { .. } => CatalogOperation::PrepareNalBootstrapProbes,
            Self::NalBootstrapPlan { .. } => CatalogOperation::PrepareNalBootstrap,
            Self::NalAnnotationValidation { .. } => CatalogOperation::ValidateNalAnnotation,
            Self::NalAnnotationPreparation { .. } => CatalogOperation::PrepareNalAnnotation,
            Self::NalMutationPreparation { .. } => CatalogOperation::PrepareNalMutation,
            Self::DuplicateCandidates { .. } => CatalogOperation::ProjectDuplicateCandidates,
            Self::MergeOperations { .. } => CatalogOperation::ProjectMergeOperations,
            Self::DuplicateDecisionPreparation { .. } => CatalogOperation::PrepareDuplicateDecision,
            Self::DuplicateDecisionCompletion { .. } => CatalogOperation::FinishDuplicateDecision,
            Self::DuplicateUndoPreparation { .. } => CatalogOperation::PrepareDuplicateUndo,
            Self::DuplicateMergePreparation { .. } => CatalogOperation::PrepareDuplicateMerge,
            Self::LiteratureLifecyclePreparation { .. } => {
                CatalogOperation::PrepareLiteratureLifecycle
            }
            Self::TrashCleanupPreparation { .. } => CatalogOperation::PrepareTrashCleanup,
            Self::MetadataPreparation { .. } => CatalogOperation::PrepareMetadata,
            Self::BibtexPreparation { .. } => CatalogOperation::PrepareBibtex,
            Self::ImportJobsProjection { .. } => CatalogOperation::ProjectImportJobs,
            Self::DoiPreview { .. } => CatalogOperation::DoiPreview,
            Self::EvidenceWriteDecision { .. } => CatalogOperation::ValidateEvidenceWrite,
            Self::DerivedViewDecision { .. } => CatalogOperation::DecideDerivedView,
            Self::EvidenceMatrixValidation { .. } => CatalogOperation::ValidateEvidenceMatrix,
            Self::ReferenceRecordPreparation { .. } => CatalogOperation::PrepareReferenceRecord,
            Self::LiteratureAttachmentPreparation { .. } => {
                CatalogOperation::PrepareLiteratureAttachment
            }
            Self::PdfImportHeaderPreparation { .. } => CatalogOperation::PreparePdfImportHeader,
            Self::PdfImportCandidateDecoded { .. } => CatalogOperation::DecodePdfImportCandidate,
            Self::ResearchConceptPreparation { .. } => CatalogOperation::PrepareResearchConcept,
            Self::ReadingUnitPreparation { .. } => CatalogOperation::PrepareReadingUnit,
            Self::StructuredValidation { .. } => CatalogOperation::ValidateStructured,
            Self::UnreviewedFields { .. } => CatalogOperation::SelectUnreviewedFields,
            Self::EditableTemplate { .. } => CatalogOperation::ValidateEditableTemplate,
            Self::PaperContext { .. } => CatalogOperation::PreparePaperContext,
            Self::PaperRetrievalTrace { .. } => CatalogOperation::DecidePaperRetrievalTrace,
            Self::SemanticIndex { .. } => CatalogOperation::PrepareSemanticIndex,
            Self::ConceptRetrieval { .. } => CatalogOperation::PrepareConceptRetrieval,
            Self::ContextMetadata { .. } => CatalogOperation::ProjectContextMetadata,
        }
    }
}
