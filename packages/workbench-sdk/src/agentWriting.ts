import type {
  AgentInputDraft,
  AgentQueueAdmission,
  AgentSubmissionPreview,
  AgentTurnOutcome,
  AgentUserInput,
  AgentWorkspaceBuffer,
  AgentWritingPrepareRequest,
  AgentWritingQueueCancelRequest,
  AgentWritingQueuePreviewRequest,
  AgentWritingQueueResponse,
  AgentWritingQueueScope,
  AgentWritingStartRequest
} from "@research-assistant/core/agent";
import type {AgentInputQueueController, AgentInputQueuePreviewGateway, AgentSubmissionGateway, AgentTurnGateway} from "@research-assistant/data/agent";
import type {ConversationDraftAcknowledgmentToken, ConversationDraftStore} from "./agentDrafts.js";
import type {
  WritingSubmissionSnapshot, WritingSubmissionAdmission, WritingDraftAcknowledgmentPort, WritingDraftReceipt,
  WritingQueueCancellationSnapshot, WritingQueueCancellationRecovery, WritingQueuePreparationSnapshot,
  WritingQueuedStartSnapshot, WritingQueuedStartQueuePort, WritingPreparationSnapshot, WritingPreparationRejection,
} from "./agentWritingState.js";

export {ReviewedSubmissionController, ReviewedSubmissionOwnerRegistry} from "@research-assistant/data/agent";
export type {SubmissionReviewAdapter, ReviewedSubmissionGateway, ReviewedSubmissionSnapshot, ReviewedSubmissionOwnerController} from "@research-assistant/data/agent";
export type {
  WritingSubmissionSnapshot, WritingSubmissionAdmission, WritingDraftAcknowledgmentPort, WritingDraftReceipt,
  WritingQueueCancellationSnapshot, WritingQueueCancellationRecovery, WritingQueuePreparationSnapshot,
  WritingQueuedStartSnapshot, WritingQueuedStartQueuePort, WritingQueuedStartResumeResult,
  WritingPreparedStart, WritingPreparationSnapshot, WritingPreparationRejection,
} from "./agentWritingState.js";

/** Public view of the original pooled Core controller. */
export interface WritingSubmissionController {
  getSnapshot: () => WritingSubmissionSnapshot;
  isOriginalPreviewCurrent(preview: AgentSubmissionPreview): boolean;
  hasQueuedPreparation: () => boolean;
  hasQueuedStartRecovery: () => boolean;
  hasWritingPreparation: () => boolean;
  configureDraftAcknowledgments(port: WritingDraftAcknowledgmentPort): void;
  configureContextAcceptance(accept: (requestId: string) => Promise<void>): () => void;
  configureQueuedStart(queue: WritingQueuedStartQueuePort, observer?: (value: WritingSubmissionAdmission) => void): void;
  checkQueuedStart(observer?: (value: WritingSubmissionAdmission) => void): Promise<void>;
  retryQueuedStart(allowResume?: boolean, observer?: (value: WritingSubmissionAdmission) => void): Promise<void>;
  subscribe: (listener: () => void) => (() => void);
  holdQueueInput(scope: AgentWritingQueueScope, inputId: string): Promise<void>;
  clearQueueInputHold(scope: AgentWritingQueueScope, inputId: string): Promise<boolean>;
  retryQueueStopHold(scope: AgentWritingQueueScope): Promise<boolean>;
  cancelPendingSend(expectedRequestId: string): Promise<boolean>;
  isCancelPending(requestId?: string): boolean;
  retrySendStopIntent(scope: AgentWritingQueueScope): Promise<boolean>;
  prepare(request: AgentWritingPrepareRequest, acknowledgment?: () => void, workspaceBuffers?: readonly AgentWorkspaceBuffer[], draftAcknowledgment?: ConversationDraftAcknowledgmentToken | null): Promise<void>;
  prepareQueued(request: AgentWritingPrepareRequest, inputId: string, expectedRevision: number, acknowledgment?: () => void, workspaceBuffers?: readonly AgentWorkspaceBuffer[], draftAcknowledgment?: ConversationDraftAcknowledgmentToken | null): Promise<void>;
  getWorkspaceBuffers(requestId: string): readonly AgentWorkspaceBuffer[] | null;
  reviewUnstartedAdmission(value: AgentQueueAdmission): void;
  recoverQueued(scope: AgentWritingQueueScope): Promise<void>;
  restoreQueuedPreparation(): Promise<void>;
  checkWritingPreparation(observer?: (value: WritingSubmissionAdmission) => void): Promise<void>;
  retryWritingPreparation(observer?: (value: WritingSubmissionAdmission) => void): Promise<void>;
  retireWritingPreparation(): Promise<void>;
  abandonWritingPreparation(): Promise<string | null>;
  retryQueuedPreparation(): Promise<void>;
  retireQueuedPreparation(hold: (intent: AgentWritingQueuePreviewRequest, eligible: () => boolean) => Promise<void>): Promise<void>;
  observeWorkspacePreparation(requestId: string, ready: boolean, cause?: unknown): Promise<boolean>;
  confirm(mode: AgentWritingStartRequest["mode"], onAdmitted?: (value: WritingSubmissionAdmission) => void): Promise<void>;
  cancelQueued(requestId: string): Promise<void>;
  /** Persist and cancel an exact prepared claim through the existing owner.
   * Busy or foreign owners retain their original work. */
  beginPreparedQueueCancellation(intent: AgentWritingQueueCancelRequest): Promise<void>;
  /** True only after this full intent committed and its local cleanup flushed. */
  isQueuedCancellationCommitted(intent: AgentWritingQueueCancelRequest): boolean;
  checkQueuedCancellation(): Promise<void>;
  /** A supplied reader must return the same exact current I/R. It is used only
   * after a definitive rejection and Native notFound permit explicit O2. */
  retryQueuedCancellation(readCurrent?: AgentInputQueuePreviewGateway["recover"]): Promise<void>;
  /** Only durable history, never a stop acknowledgement, can finish this UI run. */
  observeOutcome(turnId: string, outcome: AgentTurnOutcome): void;
  stop(): Promise<void>;
  /** Return the frozen text for the host to restore without overwriting new input.
   * Ambiguous starts cannot be discarded: retry/reconcile their original receipt.
   */
  dismiss(): string | null;
  dispose(): void;
  /**
   * Detach a view without cancelling the submission owner.  A writing panel is
   * keyed by conversation, so switching conversations unmounts the view while
   * prepare/start requests may still be in flight.  The conversation registry
   * keeps this controller alive and a later view subscribes to its snapshot.
   */
  detach(): void;
}

export declare function acquireWritingSubmissionController(key: string, gateway: AgentSubmissionGateway,
  turns: AgentTurnGateway, queueGateway?: AgentInputQueuePreviewGateway,
  recovery?: WritingQueueCancellationRecovery, isAdmissionDisabled?: () => boolean): WritingSubmissionController;
export declare function releaseWritingSubmissionController(key: string, controller: WritingSubmissionController): void;
export declare function hasPendingWritingSubmissions(): boolean;
export declare function captureWritingDraftReceipt(resources: {
  draft(): AgentInputDraft;
  acknowledgmentToken(text: string): ConversationDraftAcknowledgmentToken | null;
}, capture: (text: string) => () => void, text: string): WritingDraftReceipt;
export declare function unownedWritingDraftReceipt(text: string, input?: readonly AgentUserInput[]): WritingDraftReceipt;
export declare function decodeWritingDraftAcknowledgment(value: unknown,
  scope: AgentWritingQueueScope): ConversationDraftAcknowledgmentToken | null;
export declare function writingDraftAcknowledgments(store: ConversationDraftStore): WritingDraftAcknowledgmentPort;
export declare function writingQueueCancellationRecovery(scope: {
  manuscriptId: string | undefined;
  conversationId: string | null;
}): WritingQueueCancellationRecovery;
export declare function sameWritingQueueCancellationIntent(a: AgentWritingQueueCancelRequest,
  b: AgentWritingQueueCancelRequest): boolean;
export declare function writingQueueCancellationMessage(state: WritingQueueCancellationSnapshot | undefined): string;
export declare function writingQueuePreparationMessage(state: WritingQueuePreparationSnapshot | undefined): string;
export declare function writingWorkspacePreparationMessage(state: WritingSubmissionSnapshot, unsupported?: boolean): string;
export declare function writingQueuedStartMessage(state: WritingQueuedStartSnapshot): string;
export declare function writingQueuedStartQueue(acquire: () => {
  readonly controller: AgentInputQueueController<AgentWritingQueueScope, AgentWritingQueueResponse>;
  readonly release: () => void;
} | null, read: (scope: AgentWritingQueueScope) => Promise<AgentWritingQueueResponse>): WritingQueuedStartQueuePort;
export declare function writingPreparationDomainFields(cause: unknown): readonly string[] | null;
export declare function writingPreparationMessage(state: WritingPreparationSnapshot): string;
export declare function writingPreparationRejection(cause: unknown,
  intent: AgentWritingPrepareRequest, compact?: boolean): WritingPreparationRejection | null;
