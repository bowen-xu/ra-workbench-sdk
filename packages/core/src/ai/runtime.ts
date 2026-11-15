import type { LlmReasoningEffort } from "./llmReasoning";
import type { PaperAnalysisWorkflowStatus, PaperAnalysisTurnKind } from "./paperAnalysis";
import type { PaperTemplateRef, PaperTemplateSnapshot } from "./paperTemplate";
import type { OverviewFieldId } from "./schema";
import type { AiSuggestionCandidateKind } from "./knowledgeCandidateSchema";
import type {
  DerivedResearchViewKind,
  DerivedViewInputRef,
} from "../synthesis";

export const AI_TASK_KINDS = [
  "provider_diagnostic",
  "selection_explanation",
  "paper_profile_classification",
  "paper_overview",
  "paper_concept_map",
  "paper_suggestions",
  "reference_extraction",
  "matrix_synthesis",
] as const;

export type AiTaskKind = (typeof AI_TASK_KINDS)[number];
export type LlmUseCaseRouteId =
  | AiTaskKind
  | "paper_profile_classification"
  | "paper_reading_chat";

export const AI_RUN_STATUSES = [
  "draft", "queued", "resolving_scope", "retrieving", "extracting_evidence",
  "generating", "validating", "needs_review", "partial", "failed", "canceled",
] as const;

export type AiRunStatus = (typeof AI_RUN_STATUSES)[number];

export const AI_STAGE_KINDS = [
  "resolving_scope", "retrieving", "extracting_evidence", "generating", "validating",
] as const;

export type AiRunStageKind = (typeof AI_STAGE_KINDS)[number];
export type AiRunStageStatus = "queued" | "running" | "succeeded" | "failed" | "canceled" | "discarded";
export type AiProviderKind = "generation" | "embedding";
export type AiThinkingMode = "disabled" | "enabled";

export interface AiProviderSettingsDraft {
  readonly providerId: "fixture-generation" | "deepseek" | "qwen-embedding";
  readonly enabled: boolean;
  readonly baseUrl: string;
  readonly region: string;
  readonly modelId: string;
  readonly thinkingMode: AiThinkingMode;
  readonly timeoutMs: number;
}

export interface AiProviderSettings extends AiProviderSettingsDraft {
  readonly providerKind: AiProviderKind;
  readonly isCloud: boolean;
  readonly credentialConfigured: boolean;
  readonly credentialMask?: string;
  readonly updatedAt: string;
}

export interface AiProviderCapabilities {
  readonly providerId: string;
  readonly providerKind: AiProviderKind;
  readonly isCloud: boolean;
  readonly supportsStructuredOutput: boolean;
  readonly supportsStreaming: boolean;
  readonly supportsCancellation: boolean;
  readonly supportsUsage: boolean;
  readonly supportsVisionInput?: boolean;
}

export interface AiProviderOverview {
  readonly settings: AiProviderSettings;
  readonly capabilities: AiProviderCapabilities;
}

export interface AiCredentialSummary {
  readonly providerId: "deepseek" | "qwen" | "qwen-embedding";
  readonly configured: boolean;
  readonly maskedValue?: string;
}

export interface AiProviderTestResult {
  readonly providerId: string;
  readonly modelId: string;
  readonly reachable: boolean;
  readonly message: string;
}

export interface AiCredentialUpdate {
  readonly providerId: "deepseek" | "qwen";
  readonly apiKey: string;
}

export type LlmProviderId = "deepseek" | "qwen" | "openai";
export type LlmModelKind = "text" | "embedding" | "vision";
export type LlmRouteKind = "default" | "use_case";
export type LlmAuthMode = "api-key" | "chatgpt-login";
export type LlmProtocol = "openai-compatible" | "codex-cli";
export type { LlmReasoningEffort } from "./llmReasoning";
export type LlmContextWindowSource = "provider_runtime" | "provider_catalog" | "models_dev";

export interface LlmProviderConfigDraft {
  readonly providerId: LlmProviderId;
  readonly enabled: boolean;
  readonly baseUrl: string;
  readonly timeoutMs: number;
}

export interface LlmProviderConfig extends LlmProviderConfigDraft {
  readonly displayName: string;
  readonly authMode: LlmAuthMode;
  readonly protocol: LlmProtocol;
  readonly modelKinds: readonly LlmModelKind[];
  readonly defaultBaseUrls: readonly string[];
  readonly usesDefaultBaseUrl: boolean;
  readonly credentialConfigured: boolean;
  readonly credentialMask?: string;
}

export interface LlmModelSelection {
  readonly providerId: LlmProviderId;
  readonly modelId: string;
  readonly reasoningEffort?: LlmReasoningEffort;
  readonly serviceTier?: "fast" | "default";
}

export interface LlmModelDescriptor {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  readonly isDefault: boolean;
  readonly defaultReasoningEffort?: LlmReasoningEffort;
  readonly supportedReasoningEfforts: readonly LlmReasoningEffort[];
  readonly supportsFastMode?: boolean;
  readonly contextWindowTokens?: number;
  readonly contextWindowSource?: LlmContextWindowSource;
}

export interface LlmModelRoute {
  readonly routeKind: LlmRouteKind;
  readonly routeId: string;
  readonly label: string;
  readonly modelKind: LlmModelKind;
  readonly selection?: LlmModelSelection;
}

export interface LlmModelRouteDraft {
  readonly routeKind: LlmRouteKind;
  readonly routeId: string;
  readonly selection?: LlmModelSelection;
}

export interface LlmConfiguration {
  readonly providers: readonly LlmProviderConfig[];
  readonly defaultModels: readonly LlmModelRoute[];
  readonly useCases: readonly LlmModelRoute[];
}

export interface LlmProviderModels {
  readonly providerId: LlmProviderId;
  readonly models: readonly LlmModelDescriptor[];
  readonly catalog?: { readonly source: "remote" | "cache" | "bundled"; readonly stale: boolean; readonly fetchedAt: number };
}

export interface PaperAiReadingRegion {
  readonly pageIndex: number;
  readonly rect: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
}

export interface PaperAiReadingContextItem {
  readonly id: string;
  readonly paperId: string;
  readonly attachmentId: string;
  readonly contentSha256: string;
  readonly parseRunId: string;
  readonly rawRef: string;
  readonly kind: "text" | "table" | "picture" | "group" | "key_value" | "form" | "field" | "field_region";
  readonly label?: string;
  readonly pageIndex?: number;
  readonly regions: readonly PaperAiReadingRegion[];
  readonly charspan?: readonly [number, number];
  readonly sourceTextHash?: string;
  readonly text?: string;
  readonly tableJson?: unknown;
}

export interface PaperAiReadingImageRequest {
  readonly contextItemId: string;
  readonly attachmentId: string;
  readonly pageIndex: number;
  readonly regions: readonly PaperAiReadingRegion[];
  readonly label?: string;
}

export interface PaperAiReadingAttachmentStatus {
  readonly attachmentId: string;
  readonly displayName: string;
  readonly contentSha256: string;
  readonly parseRunId?: string;
  readonly parseStatus: "available" | "missing" | "stale";
}

export interface PaperAiReadingSessionSummary {
  readonly id: string;
  readonly paperId: string;
  readonly contextSnapshotId?: string;
  readonly attachmentIds: readonly string[];
  readonly parseRunIds: readonly string[];
  readonly providerId: LlmProviderId;
  readonly modelId: string;
  readonly reasoningEffort?: LlmReasoningEffort;
  readonly bootstrapKind: PaperReadingBootstrapKind;
  readonly sourceWorkflowId?: string;
  readonly sourceWorkflowRevision?: number;
  readonly bootstrapHash?: string;
  readonly conceptRetrievalDefault: boolean;
  readonly title: string;
  readonly status: "active" | "failed" | "archived";
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PaperAiReadingTurn {
  readonly id: string;
  readonly sessionId: string;
  readonly ordinal: number;
  readonly userMessage: string;
  readonly assistantMessage: string;
  readonly messages: readonly PaperAiReadingMessage[];
  readonly providerId: LlmProviderId;
  readonly modelId: string;
  readonly reasoningEffort?: LlmReasoningEffort;
  readonly contextWindowTokens?: number;
  readonly contextWindowSource?: LlmContextWindowSource;
  readonly status: "running" | "succeeded" | "failed" | "canceled";
  readonly inputHash?: string;
  readonly outputHash?: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly errorCode?: string;
  readonly errorMessage?: string;
  readonly conceptRetrievalEnabled: boolean;
  readonly conceptRetrievalTraceId?: string;
  readonly createdAt: string;
  readonly finishedAt?: string;
}

export interface PaperAiReadingMessage {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly content: string;
  /** Assistant text remains item-scoped even when several items share a turn. */
  readonly phase?: "commentary" | "reasoning" | "finalAnswer";
}

export interface PaperAiReadingTurnDebugData {
  readonly turnId: string;
  readonly rawRequest: unknown | null;
  readonly rawResponse: unknown | null;
}

export interface PaperAiReadingSessionDetail extends PaperAiReadingSessionSummary {
  readonly turns: readonly PaperAiReadingTurn[];
}

export interface PaperAiReadingPrepareResult {
  readonly session?: PaperAiReadingSessionSummary;
  readonly attachmentStatuses: readonly PaperAiReadingAttachmentStatus[];
  readonly contextItems: readonly PaperAiReadingContextItem[];
  readonly imageRequests: readonly PaperAiReadingImageRequest[];
  readonly textItemCount: number;
  readonly tableItemCount: number;
  readonly pictureItemCount: number;
  readonly model?: LlmModelSelection;
}

export interface PaperAiReadingImageAssetDraft {
  readonly contextItemId: string;
  readonly dataUrl: string;
}

export interface PaperAiReadingStreamEvent {
  readonly clientRequestId: string;
  readonly paperId: string;
  readonly sessionId: string;
  readonly turnId: string;
  readonly ordinal: number;
  readonly status: "started" | "delta" | "completed";
  readonly messageId?: string;
  readonly delta?: string;
  readonly accumulated: string;
}

export interface PaperAiReadingSteerResult {
  readonly status: "accepted" | "notReady" | "unsupported" | "notActive";
  readonly message?: PaperAiReadingMessage;
}

export interface PaperAiReadingCancelResult {
  readonly accepted: boolean;
  readonly resubmitMessages: readonly PaperAiReadingMessage[];
}

export interface PaperAiReadingTurnDraft {
  readonly clientRequestId?: string;
  readonly sessionId?: string;
  readonly bootstrapKind?: PaperReadingBootstrapKind;
  readonly sourceWorkflowId?: string;
  readonly conceptRetrievalTraceId?: string;
  readonly paperId: string;
  readonly attachmentIds: readonly string[];
  readonly userMessage: string;
  readonly modelSelection: LlmModelSelection;
  readonly imageAssets: readonly PaperAiReadingImageAssetDraft[];
}

export type PaperReadingBootstrapKind = "fresh_paper" | "structured_history";

export interface PaperReadingStructuredHistoryOption {
  readonly workflowId: string;
  readonly workflowRevision: number;
  readonly workflowStatus: PaperAnalysisWorkflowStatus;
  readonly providerId: LlmProviderId;
  readonly modelId: string;
  readonly completedTurns: readonly PaperAnalysisTurnKind[];
  readonly attachmentCount: number;
  readonly updatedAt: string;
}

export interface PaperReadingBootstrapOptions {
  readonly defaultKind: PaperReadingBootstrapKind;
  readonly structuredHistory?: PaperReadingStructuredHistoryOption;
  readonly unavailableReason?: string;
}

export interface DoclingPaperOverviewDraft {
  readonly paperId: string;
  readonly attachmentIds: readonly string[];
  readonly contextSnapshotId?: string;
  readonly overviewProfileSelectionRevision: number;
  readonly paperTemplateRef?: PaperTemplateRef;
  readonly modelSelection?: LlmModelSelection;
  readonly imageAssets: readonly PaperAiReadingImageAssetDraft[];
}

export interface PaperAnalysisStartDraft {
  /** Explicitly requested new generation; existing candidates and audit records are retained. */
  readonly regenerate?: boolean;
  readonly clientRequestId: string;
  readonly paperId: string;
  readonly attachmentIds: readonly string[];
  readonly overviewProfileSelectionRevision: number;
  readonly paperTemplateRef?: PaperTemplateRef;
  readonly modelSelection?: LlmModelSelection;
  readonly imageAssets: readonly PaperAiReadingImageAssetDraft[];
  /** Explicit application skill source IDs frozen into this analysis submission. */
  readonly skillSourceIds?: readonly string[];
  readonly resourceInputs?: readonly import("../agent/userInput").AgentReferenceInput[];
}

export type { PaperAnalysisWorkflowStatus, PaperAnalysisTurnKind, PaperAnalysisTurnStatus, PaperAnalysisMessageKind, PaperAnalysisMessage, PaperAnalysisAttempt, PaperAnalysisTurn, PaperAnalysisWorkflow } from "./paperAnalysis";

export interface ChatGptAccountStatus {
  readonly runtimeAvailable: boolean;
  readonly configured: boolean;
  readonly authType: string;
  readonly email?: string;
  readonly planType?: string;
}

export interface ChatGptLoginStart {
  readonly loginId: string;
  readonly authUrl: string;
}

export interface AiScopeItemDraft {
  readonly itemKind: "paper" | "attachment" | "note" | "anchor";
  readonly objectId: string;
  readonly parentObjectId?: string;
  readonly contentSha256?: string;
  readonly objectRevision?: number;
}

export interface AiTaskSpecDraft {
  readonly taskKind: AiTaskKind;
  readonly providerId: "" | "fixture-generation" | "deepseek" | "openai";
  readonly modelSelection?: LlmModelSelection;
  readonly userGoal: string;
  readonly pipelineVersion: string;
  readonly promptVersion: string;
  readonly outputSchemaVersion: number;
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
  readonly timeoutMs: number;
  readonly scopeItems: readonly AiScopeItemDraft[];
  readonly overviewFields?: readonly OverviewFieldId[];
  readonly overviewProfileSelectionRevision?: number;
  readonly paperTemplateRef?: PaperTemplateRef;
  readonly suggestionCandidateKind?: AiSuggestionCandidateKind;
  readonly matrixSynthesisContext?: AiMatrixSynthesisContextDraft;
  readonly baseCandidateId?: string;
  readonly baseCandidateRevision?: number;
  readonly confirmedScopeHash?: string;
  readonly cloudConsentVersion?: string;
}

export interface AiMatrixSynthesisContextDraft {
  readonly projectId: string;
  readonly matrixId: string;
  readonly matrixRevision: number;
  readonly viewKind: DerivedResearchViewKind;
  readonly title: string;
  readonly scopeNote: string;
  readonly inputs: readonly DerivedViewInputRef[];
}

export interface AiMatrixSynthesisContext extends AiMatrixSynthesisContextDraft {
  readonly evidenceAnchorIds: readonly string[];
}

export interface AiOverviewRetryContext {
  readonly candidateId: string;
  readonly baseRevision: number;
  readonly targetFields: readonly OverviewFieldId[];
}

export interface AiOverviewProfileContext {
  readonly paperTemplate?: PaperTemplateSnapshot;
  readonly paperId: string;
  readonly selectionRevision: number;
  readonly profileRefs: readonly {
    readonly profileId: string;
    readonly profileVersion: number;
  }[];
  readonly fieldKinds: readonly OverviewFieldId[];
}

export interface AiTaskPreview {
  readonly taskKind: AiTaskKind;
  readonly providerId: string;
  readonly modelId: string;
  readonly reasoningEffort?: LlmReasoningEffort;
  readonly isCloud: boolean;
  readonly scopeHash: string;
  readonly inputItemCount: number;
  readonly scopeItems: readonly AiScopeItem[];
  readonly requiresCloudConsent: boolean;
  readonly evidencePreview: readonly AiEvidencePreview[];
  readonly overviewProfile?: AiOverviewProfileContext;
  readonly suggestionCandidateKind?: AiSuggestionCandidateKind;
  readonly matrixSynthesisContext?: AiMatrixSynthesisContext;
  /** Shared identity used while legacy paper runs migrate to Agent turns. */
  readonly sharedConversationId?: string;
  readonly sharedRequestId?: string;
}

export interface AiEvidencePreview {
  readonly citationKey: string;
  readonly anchorId: string;
  readonly paperTitle: string;
  readonly attachmentId: string;
  readonly contentSha256: string;
  readonly pageIndex: number;
  readonly pageLabel?: string;
  readonly quoteExact: string;
  readonly contextText: string;
  readonly relationKind: "direct_quote" | "context";
}

export interface AiScopeItem {
  readonly id: string;
  readonly ordinal: number;
  readonly itemKind: AiScopeItemDraft["itemKind"];
  readonly objectId: string;
  readonly parentObjectId?: string;
  readonly contentSha256?: string;
  readonly objectRevision?: number;
  readonly snapshotHash: string;
  readonly createdAt: string;
}

export interface AiTokenUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly cacheHitTokens?: number;
  readonly cacheMissTokens?: number;
}

export interface AiRunStage extends AiTokenUsage {
  readonly id: string;
  readonly runId: string;
  readonly stageKind: AiRunStageKind;
  readonly attempt: number;
  readonly status: AiRunStageStatus;
  readonly inputHash?: string;
  readonly outputHash?: string;
  readonly durationMs?: number;
  readonly errorCode?: string;
  readonly errorMessage?: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
  readonly createdAt: string;
}

export interface AiRun extends AiTokenUsage {
  readonly id: string;
  readonly taskKind: AiTaskKind;
  readonly status: AiRunStatus;
  readonly providerId: string;
  readonly modelId: string;
  readonly reasoningEffort?: LlmReasoningEffort;
  readonly pipelineVersion: string;
  readonly promptVersion: string;
  readonly outputSchemaVersion: number;
  readonly userGoal: string;
  readonly scopeHash: string;
  readonly inputItemCount: number;
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
  readonly timeoutMs: number;
  readonly cloudConsentVersion?: string;
  readonly cloudConsentedAt?: string;
  readonly cancelRequested: boolean;
  readonly errorCode?: string;
  readonly errorMessage?: string;
  readonly createdAt: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
  readonly updatedAt: string;
  readonly scopeItems: readonly AiScopeItem[];
  readonly stages: readonly AiRunStage[];
  readonly overviewRetry?: AiOverviewRetryContext;
  readonly overviewProfile?: AiOverviewProfileContext;
  readonly suggestionCandidateKind?: AiSuggestionCandidateKind;
  readonly matrixSynthesisContext?: AiMatrixSynthesisContext;
  /** Shared Agent identity and terminal projection for migrated legacy runs. */
  readonly sharedConversationId?: string;
  readonly sharedRequestId?: string;
  readonly sharedTurnId?: string;
  readonly sharedTurnOutcome?: "completed" | "failed" | "canceled" | "interrupted";
  readonly sharedCandidateId?: string;
  readonly sharedTerminalStatus?: string;
}

export interface AiRunProgressEvent {
  readonly runId: string;
  readonly sequence: number;
}
