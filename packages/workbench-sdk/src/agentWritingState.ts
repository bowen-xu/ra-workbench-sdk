/** Original shared writing submission state and callback contracts. */
import type {
  AgentInputDraft,
  AgentSqlImmediateCode,
  AgentSqlImmediateDiagnostic,
  AgentSubmissionPreview,
  AgentTurnOutcome,
  AgentWorkspaceBuffer,
  AgentWorkspaceScope,
  AgentWritingPrepareRequest,
  AgentWritingPrepareStatusResponse,
  AgentWritingQueueCancelRequest,
  AgentWritingQueueCancelStatusResponse,
  AgentWritingQueueEditRequest,
  AgentWritingQueuePrepareStatusResponse,
  AgentWritingQueuePreviewRequest,
  AgentWritingQueuePreviewResponse,
  AgentWritingQueueResponse,
  AgentWritingQueueScope,
  AgentWritingQueuedStartRequest,
  AgentWritingQueuedStartStatusResponse,
  AgentWritingStartRequest,
  AgentWritingStartResponse,
  AgentWritingStartStatusResponse
} from "@research-assistant/core/agent";
import type {ConversationDraftAcknowledgmentToken} from "./agentDrafts.js";

export interface WritingSubmissionSnapshot {
  readonly phase: "idle" | "preparing" | "preview" | "starting" | "started" | "canceling" | "error";
  readonly queue: AgentWritingQueueResponse | null;
  readonly request: AgentWritingPrepareRequest | null;
  readonly preview: AgentSubmissionPreview | null;
  readonly admission: AgentWritingStartResponse | null;
  readonly error: "prepare" | "workspace" | "start" | "startRejected" | "stop" | "cancel" | "recover" | null;
  readonly stopPending: boolean;
  readonly stopRequested: boolean;
  /** A user-requested stop belongs to this exact submission until resolved. */
  readonly cancelSendRequested?: boolean;
  readonly sendStopIntentUnavailable?: boolean;
  readonly sendStopFailed?: boolean;
  readonly sendStopNeedsReview?: boolean;
  readonly heldQueueInputId?: string | null;
  readonly queueStopHoldUnavailable?: boolean;
  readonly outcome: AgentTurnOutcome | null;
  readonly cancellation?: WritingQueueCancellationSnapshot;
  readonly preparation?: WritingQueuePreparationSnapshot;
  readonly workspaceFailure?: unknown;
  readonly startRecovery?: WritingQueuedStartSnapshot;
  readonly writingPreparation?: WritingPreparationSnapshot;
}

export interface WritingSubmissionAdmission {
  readonly scope: AgentWorkspaceScope;
  readonly turnId: string;
}

export interface WritingQueueCancellationSnapshot {
  readonly phase: "idle" | "persisting" | "sending" | "unknown" | "checking" | "notFound" | "unconfirmed" | "clearing" | "localError" | "ready";
  readonly intent: AgentWritingQueueCancelRequest | null;
  readonly status: AgentWritingQueueCancelStatusResponse["status"] | null;
  readonly knownCommitted: boolean;
  readonly definitiveConflict: boolean;
  readonly cause: unknown;
}

export interface WritingQueueCancellationRecovery { readonly scope?: AgentWritingQueueScope; readonly storage: Storage }

export interface WritingQueuePreparationSnapshot {
  readonly phase: "idle" | "persisting" | "sending" | "unknown" | "checking" | "notFound" | "unconfirmed" | "clearing" | "localError" | "ready" | "complete" | "retired";
  readonly intent: AgentWritingQueuePreviewRequest | null;
  readonly status: AgentWritingQueuePrepareStatusResponse["status"] | null;
  readonly result: AgentWritingQueuePreviewResponse | null;
  readonly knownCommitted: boolean;
  readonly recovered: boolean;
  readonly definitiveRejection: boolean;
  readonly workspaceBuffers: readonly AgentWorkspaceBuffer[] | null;
  readonly draftAcknowledgment: ConversationDraftAcknowledgmentToken | null;
  readonly workspaceReady: boolean;
  readonly cause: unknown;
}

export interface WritingQueuedStartSnapshot {
  readonly phase: "idle" | "saving" | "sending" | "unknown" | "checking" | "prepared" | "admitted" | "rejected" | "notFound" | "unconfirmed" | "clearing" | "localError" | "done";
  readonly intent: AgentWritingQueuedStartRequest | null;
  readonly turnId: string | null;
  readonly status: AgentWritingQueuedStartStatusResponse["status"] | null;
  readonly result: AgentWritingStartResponse | null;
  readonly preview: AgentSubmissionPreview | null;
  readonly priorUnknown: boolean;
  readonly knownRejected: boolean;
  readonly recovered: boolean;
  readonly resumeCommand: AgentWritingQueueEditRequest | null;
  readonly resumeAcknowledged: boolean;
  readonly queuePaused: boolean;
  readonly cause: unknown;
  readonly draftAcknowledgment: ConversationDraftAcknowledgmentToken | null;
}

export interface WritingPreparedStart {
  readonly request: AgentWritingStartRequest;
  readonly result: AgentWritingStartResponse | null;
  readonly priorUnknown: boolean;
  readonly knownRejected: boolean;
  readonly rejection?: string | {readonly code: string; readonly reason?: "conflict"} | null;
}

export interface WritingPreparationSnapshot {
  readonly phase: "idle" | "saving" | "sending" | "unknown" | "checking" | "notFound" | "unconfirmed" | "rejected" | "ready" | "clearing" | "localError" | "complete" | "retired";
  readonly intent: AgentWritingPrepareRequest | null;
  readonly result: AgentSubmissionPreview | null;
  readonly status: AgentWritingPrepareStatusResponse["status"] | null;
  readonly knownCommitted: boolean;
  readonly priorUnknown: boolean;
  readonly knownRejected: boolean;
  readonly recovered: boolean;
  readonly workspaceBuffers: readonly AgentWorkspaceBuffer[] | null;
  readonly workspaceReady: boolean;
  readonly draftAcknowledgment: ConversationDraftAcknowledgmentToken | null;
  readonly start: WritingPreparedStart | null;
  readonly startStatus: AgentWritingStartStatusResponse["status"] | null;
  readonly cause: unknown;
}

export interface WritingDraftAcknowledgmentPort {
  flush(): Promise<void>;
  retry(): Promise<void>;
  consume(token: ConversationDraftAcknowledgmentToken, scope: AgentWritingQueueScope): Promise<void>;
}

export interface WritingDraftReceipt {
  readonly draft: AgentInputDraft;
  readonly acknowledge: () => void;
  readonly draftAcknowledgment?: ConversationDraftAcknowledgmentToken | null;
}

export type WritingQueuedStartResumeResult = "acknowledged" | "knownRejected" | "unknown";

export interface WritingQueuedStartQueuePort {
  read(intent: AgentWritingQueuedStartRequest): Promise<AgentWritingQueueResponse>;
  resume(intent: AgentWritingQueuedStartRequest, original: AgentWritingQueueEditRequest | null,
    beforeSend: (command: AgentWritingQueueEditRequest) => Promise<void>, eligible: () => boolean,
    isAdmissionDisabled?: () => boolean): Promise<WritingQueuedStartResumeResult>;
}

export type WritingPreparationRejection = string | {readonly code: "storage"; readonly reason: {
  readonly conversationId: string; readonly manuscriptId: string; readonly requestId: string; readonly operationId: string;
  readonly code: AgentSqlImmediateCode; readonly reason: AgentSqlImmediateDiagnostic;
}};
