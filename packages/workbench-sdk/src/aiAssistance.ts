import type {
  AiCandidate, AiCandidateRevisionDraft, AiOverviewConfirmationResult,
  AiOverviewConfirmationUndoDraft, AiOverviewFieldConfirmationDraft, AiRun,
  AiTaskPreview, AiTaskSpecDraft, LlmConfiguration, LlmModelRouteDraft,
  LlmProviderId, LlmProviderModels, PaperAiReadingPrepareResult,
  PaperAnalysisStartDraft, PaperAnalysisWorkflow, ConceptRetrievalPreviewDraft, ConceptRetrievalPreview,
} from "@research-assistant/core/ai";

/** Existing literature consumers and their shared route picker. Execution,
 * admission, cancellation and recovery remain with the original Core ports.
 * Credentials, login and provider configuration are outside this interface. */
export interface AiAssistanceGateway {
  getLlmConfiguration(): Promise<LlmConfiguration>;
  fetchLlmProviderModels(providerId: LlmProviderId, refresh?: boolean): Promise<LlmProviderModels>;
  saveLlmModelRoutes(drafts: readonly LlmModelRouteDraft[]): Promise<LlmConfiguration>;
  previewTask(draft: AiTaskSpecDraft): Promise<AiTaskPreview>;
  startRun(draft: AiTaskSpecDraft): Promise<AiRun>;
  getRun(runId: string): Promise<AiRun>;
  cancelRun(runId: string): Promise<boolean>;
  getLatestPaperPortraitRun(paperId: string): Promise<AiRun | undefined>;
  startPaperAnalysis(draft: PaperAnalysisStartDraft): Promise<PaperAnalysisWorkflow>;
  cancelPaperAnalysis(clientRequestId: string): Promise<boolean>;
  getLatestPaperAnalysisWorkflow(paperId: string): Promise<PaperAnalysisWorkflow | undefined>;
  listCandidates(projectId?: string, scope?: {readonly paperId: string}): Promise<readonly AiCandidate[]>;
  reviseCandidate(draft: AiCandidateRevisionDraft): Promise<AiCandidate>;
  confirmOverviewFields(draft: AiOverviewFieldConfirmationDraft): Promise<AiOverviewConfirmationResult>;
  undoOverviewConfirmation(draft: AiOverviewConfirmationUndoDraft): Promise<AiOverviewConfirmationResult>;
  recordEvidenceInspection(candidateId: string, candidateRevision: number, evidenceItemId: string): Promise<boolean>;
  preparePaperReadingContext(paperId: string, attachmentIds: readonly string[]): Promise<PaperAiReadingPrepareResult>;
  previewConceptRetrieval(draft: ConceptRetrievalPreviewDraft): Promise<ConceptRetrievalPreview>;
  cancelConceptRetrievalPreview(clientRequestId: string): Promise<boolean>;
}

/** Stable finite projection of the original live Core gateway. Reading a
 * method preserves its selected-owner binding; no extra execution owner. */
export declare function getAiAssistanceGateway(): AiAssistanceGateway;
export declare function aiAssistanceErrorMessage(reason: unknown): string;
