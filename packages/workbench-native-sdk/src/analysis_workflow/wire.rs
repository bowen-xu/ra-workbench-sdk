//! Finite decisions at the original workflow's preparation and terminal boundaries.
use super::{AnalysisWorkflowError, FailureStatuses, PaperAnalysisWorkflowDraft};
use crate::analysis_history::contracts::{PaperAnalysisMessage, PaperAnalysisWorkflow};
use research_agent_core::submission::ContextText;
use serde::{Deserialize, Serialize};

pub const CAPABILITY_ID: &str = "literature.analysis-workflow";
pub const CAPABILITY_VERSION: u32 = 1;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum WorkflowInputV1 {
    ResearchExport {
        snapshot: Box<crate::research_export::ResearchExportSnapshotV1>,
    },
    KnowledgeValidation {
        ordinal: usize,
        input: Box<crate::knowledge_promotion::KnowledgeValidationInputV1>,
    },
    PaperConceptReview {
        input: Box<crate::candidate_review::paper::PaperReviewInputV1>,
    },
    SuggestionReview {
        input: Box<crate::candidate_review::items::ItemReviewInputV1>,
    },
    MatrixContext {
        input: Box<super::matrix::MatrixContextInputV1>,
    },
    MatrixEvidence {
        input: Box<super::matrix::MatrixEvidenceInputV1>,
    },
    CandidateReview {
        input: Box<crate::candidate_review::wire::ReviewInputV1>,
    },
    ResearchEvidence {
        input: Box<super::research::ResearchPromptInputV1>,
    },
    ResearchPrompt {
        input: Box<super::research::ResearchPromptInputV1>,
    },
    SelectionEvidence {
        source: Option<crate::generation::evidence::AnchorEvidence>,
    },
    SuggestionPrompt {
        candidate_kind: String,
        user_goal: String,
        evidence: Vec<crate::generation::evidence::AiEvidencePreview>,
    },
    PortraitSources {
        statuses: Vec<String>,
        context_items: usize,
    },
    PortraitEvidence {
        status: String,
        items: usize,
    },
    PortraitPaper {
        paper_id: String,
    },
    CandidateRecovery {
        input: super::recovery::CandidateRecoveryInputV1,
    },
    RenderAttemptMessages {
        messages: Vec<PaperAnalysisMessage>,
    },
    ValidateAttemptInput {
        turn_kind: String,
        contents: Vec<String>,
    },
    PlanAttempt {
        turn_kind: String,
        workflow: crate::analysis_attempt::AnalysisAttemptWorkflowObservation,
    },
    ValidateDoclingImages {
        requested_ids: Vec<String>,
        available_ids: Vec<String>,
    },
    ValidateDoclingStart {
        revision: i64,
        has_template: bool,
    },
    ValidateDoclingSources {
        statuses: Vec<String>,
        picture_count: usize,
    },
    DoclingRow {
        input_cbor_base64: String,
    },
    DoclingPrompt {
        input_cbor_base64: String,
    },
    Candidate {
        input: Box<super::candidate::CandidateInputV1>,
    },
    OverviewTask {
        input: super::overview_task::OverviewTaskInputV1,
    },
    TaskShape {
        draft_cbor_base64: String,
    },
    TaskScope {
        task_kind: String,
        item_kinds: Vec<String>,
    },
    PageAttachment {
        attachment: Option<crate::generation::evidence::AttachmentEvidence>,
    },
    PagePreview {
        attachment_id: String,
        attachment: crate::generation::evidence::AttachmentEvidence,
        pages: Vec<(i64, String)>,
    },
    PageSources {
        attachment_id: String,
        attachment: crate::generation::evidence::AttachmentEvidence,
        pages: Vec<(i64, String)>,
    },
    Template {
        input: Box<super::template::TemplateInputV1>,
    },
    SubmissionScope {
        task_kind: String,
        paper_ids: Vec<String>,
        attachment_ids: Vec<String>,
    },
    CompletionProjection {
        input_cbor_base64: String,
    },
    RenderPrompt {
        input_cbor_base64: String,
    },
    ValidateGeneration {
        portrait_active: bool,
        analysis_active: bool,
    },
    SelectConversation {
        unarchived: Option<String>,
    },
    ValidateTurn {
        turn_kind: String,
    },
    ValidateStart {
        revision: i64,
        has_template: bool,
    },
    ValidateSources {
        statuses: Vec<String>,
        picture_count: usize,
    },
    ValidateReuse {
        regenerate: bool,
        template_json: Option<String>,
        existing: Option<Box<PaperAnalysisWorkflow>>,
    },
    ValidateDraft {
        draft: PaperAnalysisWorkflowDraft,
    },
    OverviewMessages {
        workflow: Box<PaperAnalysisWorkflow>,
    },
    RunningStatus {
        turn_kind: String,
    },
    CompletionStatus {
        turn_kind: String,
        has_concept_turn: bool,
    },
    FailureStatuses {
        turn_kind: String,
        error_code: String,
    },
    PackSources {
        sources: Vec<ContextText>,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum WorkflowDecisionV1 {
    ResearchExport {
        result: Result<
            Box<crate::research_export::PreparedResearchExportV1>,
            crate::research_export::ResearchExportRejectionV1,
        >,
    },
    KnowledgeValidation {
        decision: crate::knowledge_promotion::KnowledgeValidationDecisionV1,
    },
    PaperConceptReview {
        decision: crate::candidate_review::paper::PaperReviewDecisionV1,
    },
    SuggestionReview {
        decision: crate::candidate_review::items::ItemReviewDecisionV1,
    },
    MatrixContext {
        decision: super::matrix::MatrixContextDecisionV1,
    },
    MatrixEvidence {
        decision: super::matrix::MatrixEvidenceDecisionV1,
    },
    CandidateReview {
        decision: crate::candidate_review::wire::ReviewDecisionV1,
    },
    ResearchPrompt {
        result: Result<super::research::ResearchPromptV1, AnalysisWorkflowError>,
    },
    SelectionEvidence {
        result: Result<Vec<crate::generation::evidence::AiEvidencePreview>, AnalysisWorkflowError>,
    },
    SuggestionPrompt {
        result: Result<super::SuggestionPromptV1, AnalysisWorkflowError>,
    },
    PageSources {
        result:
            Result<Vec<crate::generation::evidence::PreparedPageEvidence>, AnalysisWorkflowError>,
    },
    CandidateRecovery {
        policy: Option<super::recovery::CandidateRecoveryPolicyV1>,
    },
    AttemptPlan {
        result: Result<crate::analysis_attempt::AnalysisAttemptPlan, AnalysisWorkflowError>,
    },
    DoclingRow {
        decision: super::docling::DoclingRowDecisionV1,
    },
    DoclingPrompt {
        result_cbor_base64: String,
    },
    Candidate {
        decision: super::candidate::CandidateDecisionV1,
    },
    OverviewTask {
        draft_cbor_base64: String,
    },
    PagePreview {
        result: Result<Vec<crate::generation::evidence::AiEvidencePreview>, AnalysisWorkflowError>,
    },
    Template {
        decision: super::template::TemplateDecisionV1,
    },
    SubmissionScope {
        result: Result<super::submission::SubmissionScopeV1, AnalysisWorkflowError>,
    },
    CompletionProjection {
        result: Result<String, AnalysisWorkflowError>,
    },
    Prompt {
        result_cbor_base64: String,
    },
    Conversation {
        decision: ConversationDecisionV1,
    },
    Validated {
        rejection: Option<AnalysisWorkflowError>,
    },
    Messages {
        messages: Vec<PaperAnalysisMessage>,
    },
    Status {
        status: String,
    },
    Failure {
        statuses: FailureStatuses,
    },
    Sources {
        result: Result<Vec<ContextText>, AnalysisWorkflowError>,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ConversationDecisionV1 {
    Reuse { conversation_id: uuid::Uuid },
    Create {},
    Rejected { error: AnalysisWorkflowError },
}

impl WorkflowInputV1 {
    /// Match finite output families and typed payload shape. Domain values remain Native policy.
    pub fn matches_decision(&self, decision: &WorkflowDecisionV1) -> bool {
        if let (Self::ResearchExport { snapshot }, WorkflowDecisionV1::ResearchExport { result }) =
            (self, decision)
        {
            return result.as_ref().map_or(true, |prepared| {
                prepared.exported_at == snapshot.exported_at
            });
        }
        if let (
            Self::KnowledgeValidation { input, .. },
            WorkflowDecisionV1::KnowledgeValidation { decision },
        ) = (self, decision)
        {
            return input.matches_decision(decision);
        }
        if let (
            Self::PaperConceptReview { input },
            WorkflowDecisionV1::PaperConceptReview { decision },
        ) = (self, decision)
        {
            return input.matches_decision(decision);
        }
        if let (Self::MatrixContext { input }, WorkflowDecisionV1::MatrixContext { decision }) =
            (self, decision)
        {
            return input.matches_decision(decision);
        }
        if let (Self::MatrixEvidence { input }, WorkflowDecisionV1::MatrixEvidence { decision }) =
            (self, decision)
        {
            return input.matches_decision(decision);
        }
        if let (
            Self::SuggestionReview { input },
            WorkflowDecisionV1::SuggestionReview { decision },
        ) = (self, decision)
        {
            return input.matches_decision(decision);
        }
        if let (Self::CandidateReview { input }, WorkflowDecisionV1::CandidateReview { decision }) =
            (self, decision)
        {
            return input.matches_decision(decision);
        }
        if let (
            Self::DoclingRow { input_cbor_base64 },
            WorkflowDecisionV1::DoclingRow { decision },
        ) = (self, decision)
        {
            return crate::paper_context_wire::decode_payload::<super::docling::DoclingRowInputV1>(
                input_cbor_base64,
            )
            .is_ok_and(|input| input.matches_decision(decision));
        }
        if let (
            Self::DoclingPrompt { input_cbor_base64 },
            WorkflowDecisionV1::DoclingPrompt { result_cbor_base64 },
        ) = (self, decision)
        {
            return crate::paper_context_wire::decode_payload::<super::docling::DoclingPromptInputV1>(input_cbor_base64)
                .is_ok_and(|input| crate::paper_context_wire::decode_payload::<Result<crate::generation::provider::ProviderInput, AnalysisWorkflowError>>(result_cbor_base64)
                    .is_ok_and(|result| input.matches_result(&result)));
        }
        if let (
            Self::PlanAttempt {
                turn_kind,
                workflow,
            },
            WorkflowDecisionV1::AttemptPlan { result },
        ) = (self, decision)
        {
            return match result {
                Err(_) => true,
                Ok(plan) => workflow
                    .turns
                    .iter()
                    .find(|turn| &turn.kind == turn_kind)
                    .is_some_and(|turn| turn.id == plan.turn_id),
            };
        }
        if let (Self::Candidate { input }, WorkflowDecisionV1::Candidate { decision }) =
            (self, decision)
        {
            return input.matches_decision(decision);
        }
        if let (
            Self::SelectionEvidence { source },
            WorkflowDecisionV1::SelectionEvidence { result },
        ) = (self, decision)
        {
            return match result {
                Err(_) => true,
                Ok(items) => source.as_ref().is_some_and(|source| {
                    items.len() == 2
                        && items.iter().all(|item| {
                            item.anchor_id == source.anchor_id
                                && item.attachment_id == source.attachment_id
                                && item.content_sha256 == source.content_sha256
                                && item.paper_title == source.paper_title
                                && item.page_index == source.page_index
                                && item.page_label == source.page_label
                                && item.quote_exact == source.quote_exact
                        })
                }),
            };
        }
        match (self, decision) {
            (
                Self::OverviewTask { input },
                WorkflowDecisionV1::OverviewTask { draft_cbor_base64 },
            ) => {
                return crate::paper_context_wire::decode_payload::<
                    crate::generation::AiTaskSpecDraft,
                >(draft_cbor_base64)
                .is_ok_and(|draft| {
                    draft.task_kind == "paper_overview"
                        && draft.scope_items.len() == input.attachment_ids.len()
                        && draft.base_candidate_id.is_none()
                        && draft.base_candidate_revision.is_none()
                        && draft.overview_fields.is_empty()
                        && draft.model_selection == input.model_selection
                        && draft.paper_template_ref == input.template
                        && draft.overview_profile_selection_revision
                            == if input.template.is_some() {
                                None
                            } else {
                                Some(input.selection_revision)
                            }
                        && draft
                            .scope_items
                            .iter()
                            .zip(&input.attachment_ids)
                            .all(|(scope, id)| {
                                scope.item_kind == "attachment"
                                    && scope.object_id == *id
                                    && scope.parent_object_id.as_ref() == Some(&input.paper_id)
                            })
                });
            }
            (
                Self::PageSources {
                    attachment_id,
                    attachment,
                    ..
                },
                WorkflowDecisionV1::PageSources { result },
            ) => {
                return match result {
                    Err(_) => true,
                    Ok(rows) => {
                        rows.len() <= 10
                            && rows.iter().all(|row| {
                                row.source.attachment_id == *attachment_id
                                    && row.source.content_sha256 == attachment.content_sha256
                                    && row.source.paper_id == attachment.paper_id
                                    && row.source.paper_title == attachment.paper_title
                            })
                    }
                };
            }
            (
                Self::PagePreview {
                    attachment_id,
                    attachment,
                    ..
                },
                WorkflowDecisionV1::PagePreview { result },
            ) => {
                return match result {
                    Err(_) => true,
                    Ok(items) => {
                        items.len() <= 10
                            && items.iter().all(|item| {
                                item.attachment_id == *attachment_id
                                    && item.content_sha256 == attachment.content_sha256
                            })
                    }
                };
            }
            _ => {}
        }
        if let (Self::Template { input }, WorkflowDecisionV1::Template { decision }) =
            (self, decision)
        {
            return input.matches_decision(decision);
        }
        let family = matches!(
            (self, decision),
            (
                Self::ResearchPrompt { .. },
                WorkflowDecisionV1::ResearchPrompt { .. }
            ) | (
                Self::SuggestionPrompt { .. },
                WorkflowDecisionV1::SuggestionPrompt { .. }
            ) | (
                Self::CandidateRecovery { .. },
                WorkflowDecisionV1::CandidateRecovery { .. }
            ) | (
                Self::ResearchEvidence { .. }
                    | Self::ValidateGeneration { .. }
                    | Self::TaskScope { .. }
                    | Self::PortraitSources { .. }
                    | Self::PortraitEvidence { .. }
                    | Self::PortraitPaper { .. }
                    | Self::ValidateAttemptInput { .. }
                    | Self::ValidateDoclingImages { .. }
                    | Self::ValidateDoclingStart { .. }
                    | Self::ValidateDoclingSources { .. }
                    | Self::TaskShape { .. }
                    | Self::PageAttachment { .. }
                    | Self::ValidateTurn { .. }
                    | Self::ValidateStart { .. }
                    | Self::ValidateSources { .. }
                    | Self::ValidateReuse { .. }
                    | Self::ValidateDraft { .. },
                WorkflowDecisionV1::Validated { .. }
            ) | (
                Self::OverviewMessages { .. },
                WorkflowDecisionV1::Messages { .. }
            ) | (
                Self::RunningStatus { .. } | Self::CompletionStatus { .. },
                WorkflowDecisionV1::Status { .. }
            ) | (
                Self::FailureStatuses { .. },
                WorkflowDecisionV1::Failure { .. }
            ) | (Self::PackSources { .. }, WorkflowDecisionV1::Sources { .. })
                | (
                    Self::RenderPrompt { .. } | Self::RenderAttemptMessages { .. },
                    WorkflowDecisionV1::Prompt { .. }
                )
                | (
                    Self::SelectConversation { .. },
                    WorkflowDecisionV1::Conversation { .. }
                )
                | (
                    Self::SubmissionScope { .. },
                    WorkflowDecisionV1::SubmissionScope { .. }
                )
                | (
                    Self::CompletionProjection { .. },
                    WorkflowDecisionV1::CompletionProjection { .. }
                )
        );
        if !family {
            return false;
        }
        if let (
            Self::SubmissionScope {
                paper_ids,
                attachment_ids,
                ..
            },
            WorkflowDecisionV1::SubmissionScope { result: Ok(scope) },
        ) = (self, decision)
        {
            return paper_ids.first() == Some(&scope.paper_id)
                && scope.attachment_ids == *attachment_ids
                && matches!(scope.kind.as_str(), "portrait" | "structuredReading");
        }
        if let WorkflowDecisionV1::Prompt { result_cbor_base64 } = decision {
            return crate::paper_context_wire::decode_payload::<
                Result<super::prompt::PaperTaskPrompt, AnalysisWorkflowError>,
            >(result_cbor_base64)
            .is_ok();
        }
        true
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkflowWireInputV1 {
    pub cbor_base64: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkflowWireOutcomeV1 {
    pub input: WorkflowWireInputV1,
    pub decision_cbor_base64: String,
}
