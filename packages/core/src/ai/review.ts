import type { AiCandidatePayloadV1 } from "./schema";

export type AiCandidateReviewState =
  | "unreviewed"
  | "edited"
  | "partially_accepted"
  | "deferred"
  | "needs_more_evidence"
  | "accepted_unchanged"
  | "accepted_after_edit"
  | "rejected";

export type AiReviewAction =
  | "accept_unchanged"
  | "accept_after_edit"
  | "reject"
  | "defer"
  | "request_more_evidence";

export interface AiEvidenceItem {
  readonly id: string;
  readonly citationKey: string;
  readonly ordinal: number;
  readonly anchorId: string;
  readonly paperId: string;
  readonly paperTitle: string;
  readonly attachmentId: string;
  readonly contentSha256: string;
  readonly pageIndex: number;
  readonly pageLabel?: string;
  readonly quoteExact: string;
  readonly quotePrefix: string;
  readonly quoteSuffix: string;
  readonly contextText: string;
  readonly relationKind: "direct_quote" | "context";
  readonly validationStatus: "valid" | "invalid";
  readonly currentAnchorStatus: AiAnchorStatus;
  readonly createdAt: string;
}

export type AiAnchorStatus = "exact" | "page_level" | "stale" | "missing";

export type AiCitationSemanticRelation =
  | "supports"
  | "partially_supports"
  | "context_only"
  | "opposes"
  | "unsupported"
  | "uncertain";

export interface AiCitationAssessment {
  readonly id: string;
  readonly candidateId: string;
  readonly candidateRevision: number;
  readonly statementId: string;
  readonly evidenceItemId: string;
  readonly assessmentRevision: number;
  readonly semanticRelation: AiCitationSemanticRelation;
  readonly rationale: string;
  readonly idempotencyKey: string;
  readonly assessedAt: string;
}

export interface AiCitationAssessmentDraft {
  readonly candidateId: string;
  readonly candidateRevision: number;
  readonly statementId: string;
  readonly evidenceItemId: string;
  readonly expectedAssessmentRevision: number;
  readonly semanticRelation: AiCitationSemanticRelation;
  readonly rationale: string;
  readonly idempotencyKey: string;
}

export interface AiEvidenceBundle {
  readonly id: string;
  readonly runId: string;
  readonly scopeHash: string;
  readonly retrievalConfigVersion: string;
  readonly validationStatus: "valid" | "partial" | "invalid";
  readonly createdAt: string;
  readonly items: readonly AiEvidenceItem[];
}

export interface AiCandidateRevision {
  readonly id: string;
  readonly revision: number;
  readonly payload: AiCandidatePayloadV1;
  readonly payloadHash: string;
  readonly editorKind: "ai" | "human" | "ai_retry";
  readonly sourceRunId?: string;
  readonly parentRevision?: number;
  readonly changeReason: string;
  readonly createdAt: string;
}

export interface AiReviewDecision {
  readonly id: string;
  readonly candidateId: string;
  readonly candidateRevision: number;
  readonly action: AiReviewAction;
  readonly rationale: string;
  readonly idempotencyKey: string;
  readonly targetObjectKind?: "reading_unit" | "reference_record" | "derived_research_view" | "paper_portrait";
  readonly targetObjectId?: string;
  readonly targetObjectRevision?: number;
  readonly createdAt: string;
}

export type AiAttentionFeedbackKind = "useful" | "not_useful" | "dismissed";

export interface AiAttentionFeedback {
  readonly id: string;
  readonly candidateId: string;
  readonly candidateRevision: number;
  readonly suggestionId: string;
  readonly feedbackKind: AiAttentionFeedbackKind;
  readonly note: string;
  readonly idempotencyKey: string;
  readonly createdAt: string;
}

export interface AiAttentionFeedbackDraft {
  readonly candidateId: string;
  readonly candidateRevision: number;
  readonly suggestionId: string;
  readonly feedbackKind: AiAttentionFeedbackKind;
  readonly note: string;
  readonly idempotencyKey: string;
}

export type AiSuggestionResolutionDraft =
  | { readonly kind: "create_concept" }
  | { readonly kind: "link_concept"; readonly conceptId: string }
  | { readonly kind: "unresolved" }
  | { readonly kind: "attach_definition"; readonly conceptId: string }
  | {
      readonly kind: "assert_relation";
      readonly subjectConceptId: string;
      readonly objectConceptId: string;
      readonly projectId?: string;
    };

export type AiSuggestionResolutionKind = AiSuggestionResolutionDraft["kind"] | "none";

export interface AiSuggestionItemDecisionDraft {
  readonly candidateId: string;
  readonly candidateRevision: number;
  readonly suggestionId: string;
  readonly action: AiReviewAction;
  readonly rationale: string;
  readonly idempotencyKey: string;
  readonly resolution?: AiSuggestionResolutionDraft;
}

export interface AiSuggestionItemDecision {
  readonly id: string;
  readonly candidateId: string;
  readonly candidateRevision: number;
  readonly suggestionId: string;
  readonly action: AiReviewAction;
  readonly resolutionKind: AiSuggestionResolutionKind;
  readonly rationale: string;
  readonly idempotencyKey: string;
  readonly targetObjectKind?: "concept" | "term_usage" | "definition_claim" | "relation_assertion";
  readonly targetObjectId?: string;
  readonly targetObjectRevision?: number;
  readonly createdAt: string;
}

export type AiCandidateSummarySourceKind = "local_extractive" | "ai_generated" | "human";

export interface AiCandidateSummaryVersion {
  readonly id: string;
  readonly candidateId: string;
  readonly candidateRevision: number;
  readonly version: number;
  readonly summary: string;
  readonly sourceKind: AiCandidateSummarySourceKind;
  readonly isSelected: boolean;
  readonly createdAt: string;
  readonly discardedAt?: string;
}

export interface AiCandidateSummaryVersionDraft {
  readonly candidateId: string;
  readonly candidateRevision: number;
  readonly idempotencyKey: string;
}

export interface AiCandidateSummarySelectionDraft {
  readonly candidateId: string;
  readonly candidateRevision: number;
  readonly summaryVersionId: string;
}

export interface AiCandidateSummaryDiscardDraft {
  readonly candidateId: string;
  readonly candidateRevision: number;
  readonly keepSummaryVersionId: string;
}

export interface AiCandidate {
  readonly id: string;
  readonly runId: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly candidateKind: AiCandidatePayloadV1["kind"];
  readonly schemaVersion: 1;
  readonly currentRevision: number;
  readonly reviewState: AiCandidateReviewState;
  readonly validationStatus: "valid";
  readonly originalPayloadHash: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly evidenceBundle: AiEvidenceBundle;
  readonly revisions: readonly AiCandidateRevision[];
  readonly decisions: readonly AiReviewDecision[];
  readonly attentionFeedback: readonly AiAttentionFeedback[];
  readonly suggestionItemDecisions: readonly AiSuggestionItemDecision[];
  readonly citationAssessments: readonly AiCitationAssessment[];
  /** Evidence items inspected for the current candidate revision. Older peers may omit this field. */
  readonly inspectedEvidenceItemIds?: readonly string[];
  readonly overviewFieldConfirmations: readonly AiOverviewFieldConfirmation[];
  readonly summaryVersions?: readonly AiCandidateSummaryVersion[];
}

export type AiOverviewFieldDecisionKind = "ai_unchanged" | "human_edited";
export type AiOverviewConfirmationScopeKind = "field" | "block" | "paper";

export interface AiOverviewFieldConfirmation {
  readonly id: string;
  readonly batchId: string;
  readonly candidateId: string;
  readonly candidateRevision: number;
  readonly fieldKind: string;
  readonly fieldPayloadHash: string;
  readonly decisionKind: AiOverviewFieldDecisionKind;
  readonly targetReadingUnitId: string;
  readonly targetAppliedRevision: number;
  readonly active: boolean;
  readonly createdAt: string;
  readonly undoneAt?: string;
  readonly reviewResetAt?: string;
}

export interface AiOverviewConfirmationBatch {
  readonly id: string;
  readonly candidateId: string;
  readonly candidateRevision: number;
  readonly scopeKind: AiOverviewConfirmationScopeKind;
  readonly paperId: string;
  readonly projectId?: string;
  readonly idempotencyKey: string;
  readonly createdAt: string;
  readonly fieldConfirmations: readonly AiOverviewFieldConfirmation[];
  readonly active: boolean;
  readonly undoneAt?: string;
}

export interface AiOverviewFieldConfirmationDraft {
  readonly candidateId: string;
  readonly candidateRevision: number;
  readonly fieldKinds: readonly string[];
  readonly scopeKind: AiOverviewConfirmationScopeKind;
  readonly projectId?: string;
  readonly idempotencyKey: string;
}

export interface AiOverviewConfirmationUndoDraft {
  readonly batchId: string;
  readonly idempotencyKey: string;
  /** Reset only this field's review marker, preserving its reading text and other fields. */
  readonly fieldKind?: string;
}

export interface AiOverviewConfirmationResult {
  readonly candidate: AiCandidate;
  readonly batch: AiOverviewConfirmationBatch;
}

export interface AiPaperReviewOverviewTargetDraft {
  readonly candidateId: string;
  readonly candidateRevision: number;
  readonly fieldKinds: readonly string[];
}

export interface AiPaperReviewConfirmationDraft {
  readonly paperId: string;
  readonly projectId?: string;
  readonly metadataFieldNames: readonly string[];
  readonly overviewTargets: readonly AiPaperReviewOverviewTargetDraft[];
  readonly idempotencyKey: string;
}

export interface AiPaperReviewConfirmationUndoDraft {
  readonly batchId: string;
  readonly idempotencyKey: string;
}

export interface AiPaperReviewMetadataConfirmation {
  readonly id: string;
  readonly fieldName: string;
  readonly active: boolean;
  readonly createdAt: string;
  readonly undoneAt?: string;
}

export interface AiPaperReviewConfirmationBatch {
  readonly id: string;
  readonly paperId: string;
  readonly projectId?: string;
  readonly idempotencyKey: string;
  readonly metadataConfirmations: readonly AiPaperReviewMetadataConfirmation[];
  readonly overviewBatchIds: readonly string[];
  readonly active: boolean;
  readonly createdAt: string;
  readonly undoneAt?: string;
}

export interface AiPaperReviewConfirmationResult {
  readonly batch: AiPaperReviewConfirmationBatch;
  readonly candidates: readonly AiCandidate[];
  readonly moduleFailures: readonly string[];
}

export interface AiCandidateRevisionDraft {
  readonly candidateId: string;
  readonly expectedRevision: number;
  readonly payload: AiCandidatePayloadV1;
  readonly changeReason: string;
}

export interface AiReviewDecisionDraft {
  readonly candidateId: string;
  readonly candidateRevision: number;
  readonly action: AiReviewAction;
  readonly rationale: string;
  readonly idempotencyKey: string;
  readonly readingUnitTitle?: string;
  readonly projectId?: string;
}
