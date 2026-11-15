import type {
  AgentConversationProjection, AgentInputDraft, AgentNoteQueueResponse, AgentNoteQueueScope,
  AgentNoteSteeringScope, AgentPaperQueueResponse, AgentPaperQueueScope, AgentPaperSteerRequest,
  AgentQueueEdit, AgentQueueState, AgentSteeringHandoffIntent, AgentUserInput,
  AgentWritingQueuePreviewRequest, AgentWritingQueueResponse, AgentWritingQueueScope, AgentWritingSteerRequest,
} from "@research-assistant/core/agent";
import type {
  AgentInputQueueController, AgentInputQueueRegistry, AgentInputQueueState, AgentQueueGateway,
  AgentSteeringHandoffRegistry, AgentSteeringHandoffState, AgentSteeringRegistry, AgentSteeringState,
} from "@research-assistant/data/agent";
import type {JSX, ReactNode, RefObject} from "react";
import type {ConversationInputDraft} from "./agentDrafts.js";
import type {AgentResourceGateways} from "./agentContextControls.js";
import type {WritingAgentMessage} from "./agentMessages.js";

export interface AgentCommandUsage {
  readonly inputTokens: number;
  readonly contextWindowTokens: number;
}
export interface AgentCompactResult {
  readonly beforeTokens: number;
  readonly usage: AgentCommandUsage;
}
export interface AgentCommandRequest {
  readonly conversationId: string;
  readonly signal: AbortSignal;
}
export interface AgentCompactRequest extends AgentCommandRequest {
  readonly requestId?: string;
}
export interface AgentCommandGateway {
  readUsage(request: AgentCommandRequest): Promise<AgentCommandUsage>;
  compact(request: AgentCompactRequest): Promise<AgentCompactResult>;
}
export interface AgentCompactionRecord {
  readonly id: string;
  readonly conversationId: string;
  readonly afterMessageId?: string | undefined;
  readonly requestId?: string | undefined;
  readonly inputId?: string | undefined;
  readonly state: "pending" | "completed" | "failed";
  readonly result?: AgentCompactResult;
}
export interface AgentCommandExecution {
  compact(value: string, options?: {
    readonly preserveDraft?: boolean;
    readonly requestId?: string;
    readonly queued?: {readonly inputId: string; readonly explicit: boolean};
  }): Promise<boolean>;
  pending: boolean;
  usage: AgentCommandUsage | undefined;
  activities: readonly AgentCompactionRecord[];
}
export interface AgentComposerDraftAccess {
  readonly subscribe?: (listener: () => void) => () => void;
  readonly draft: () => ConversationInputDraft;
  readonly set: (draft: AgentInputDraft) => void;
  readonly error?: () => string;
}

/** Presentation order stays in the original Core-owned instance. */
export interface PendingSteeringOrderStore {
  read(key: string, conversationId: string): readonly string[];
  commit(key: string, conversationId: string, ids: readonly string[]): void;
  forgetConversation(conversationId: string): void;
}
export interface AgentSteeringOwners {
  pendingOrder: PendingSteeringOrderStore;
  conversations: AgentSteeringRegistry<{conversationId: string; turnId: string}>;
  handoffs: AgentSteeringHandoffRegistry;
  writing: AgentSteeringRegistry<Omit<AgentWritingSteerRequest, "inputId" | "text">>;
  notes: AgentSteeringRegistry<AgentNoteSteeringScope>;
  papers: AgentSteeringRegistry<Omit<AgentPaperSteerRequest, "inputId" | "text">>;
}
export declare function useAgentSteeringOwners(): AgentSteeringOwners | null;
export declare function useAgentQueueOwners(): {
  conversations: AgentInputQueueRegistry<{conversationId: string}, AgentQueueState>;
  writing: AgentInputQueueRegistry<AgentWritingQueueScope, AgentWritingQueueResponse>;
  notes: AgentInputQueueRegistry<AgentNoteQueueScope, AgentNoteQueueResponse>;
  papers: AgentInputQueueRegistry<AgentPaperQueueScope, AgentPaperQueueResponse>;
} | null;

export interface PendingAgentSubmission {
  readonly id: string;
  readonly conversationId: string;
  readonly turnId?: string | undefined;
  readonly text: string;
  readonly userInput?: readonly AgentUserInput[] | undefined;
}
export declare function hasConfirmedSubmissionMessage(pending: PendingAgentSubmission,
  messages: readonly WritingAgentMessage[]): boolean;
export declare function AgentPendingSubmissionBubble(props: {
  readonly pending: PendingAgentSubmission | null;
  readonly messages: readonly WritingAgentMessage[];
  readonly resourceGateways?: AgentResourceGateways | undefined;
}): JSX.Element | null;
export declare function AgentPendingSteeringBubbles(props: {
  readonly messages: readonly WritingAgentMessage[];
  readonly conversationId: string;
  readonly orderKey?: string | undefined;
  readonly direct?: readonly {
    readonly conversationId: string;
    readonly turnId: string;
    readonly inputId: string;
    readonly text: string;
    readonly userInput?: readonly AgentUserInput[];
  }[] | undefined;
  readonly handoffs?: readonly AgentSteeringHandoffIntent[] | undefined;
  readonly resourceGateways?: AgentResourceGateways | undefined;
}): JSX.Element | null;
export declare function AgentSteeringHandoffRecovery(props: {
  readonly available: boolean;
  readonly state: AgentSteeringHandoffState | null;
  readonly disabled: boolean;
  readonly canRetry: boolean;
  readonly queueContainsInput: boolean;
  readonly onCheck: () => void;
  readonly onRetry: () => void;
}): JSX.Element;
export declare function AgentSteeringReceipt(props: {
  readonly uncertain: boolean;
  readonly pending: boolean;
  readonly text: string | undefined;
  readonly status: string;
  readonly requestId?: string;
  readonly disabled: boolean;
  readonly onRetry: () => void;
  readonly awaitingHistory?: readonly {readonly inputId: string; readonly text: string}[] | undefined;
  readonly transferFailures?: readonly string[] | undefined;
  readonly onRetryTransfer?: (inputId: string) => void;
  readonly hidePendingMessages?: boolean;
}): JSX.Element | null;
export declare function AgentSubmissionFeedback(props: {
  readonly children: ReactNode;
  readonly label?: string;
  readonly className?: string;
}): JSX.Element;

export interface AgentSteeringOwner<S extends {conversationId: string; turnId: string}> {
  readonly registry: AgentSteeringRegistry<S>;
  readonly hostKey: string;
  readonly conversationId: string;
  readonly captureAcknowledgment: (text: string) => () => void;
  readonly queueRejected?: (request: {
    readonly inputId: string; readonly text: string; readonly userInput?: readonly AgentUserInput[];
  }, acknowledge?: () => void) => Promise<boolean>;
}
export interface AgentSteeringSubmitCallbacks {
  readonly userInput?: readonly AgentUserInput[];
  readonly accepted?: () => void;
  readonly confirmed?: () => void | boolean | Promise<void | boolean>;
  readonly queueRejected?: AgentSteeringOwner<{conversationId: string; turnId: string}>["queueRejected"];
  readonly rejected?: () => void;
}
export declare function useAgentSteering<S extends {conversationId: string; turnId: string}>(
  scope: S | null, key: string, send: (request: S & {inputId: string; text: string}) => Promise<unknown>,
  accepted: (text: string) => void, projection?: AgentConversationProjection | null,
  owner?: AgentSteeringOwner<S>, historyGate?: {readonly isReady: () => boolean; readonly state: unknown},
  isAdmissionDisabled?: () => boolean,
): {
  submit(text: string, callbacks?: AgentSteeringSubmitCallbacks): Promise<boolean>;
  retry(): Promise<boolean>;
  retryConfirmation(inputId: string): void;
  state: AgentSteeringState<S>;
  unresolved: boolean;
  pending: boolean;
  uncertain: boolean;
  status: string;
};

export declare function reconcileSteeringTransfer<S, Q extends AgentQueueState>(
  controller: AgentInputQueueController<S, Q> | null, inputId: string,
  retryConfirmation: (inputId: string) => void,
): Promise<void>;
export declare function useAgentInputQueue<S extends {conversationId: string}, Q extends AgentQueueState>(
  gateway: AgentQueueGateway<S, Q>, scope: S | null, ready: boolean, refresh: number,
  registry?: AgentInputQueueRegistry<S, Q>,
): {
  controller: RefObject<AgentInputQueueController<S, Q> | null>;
  state: AgentInputQueueState<Q> | null;
  retainTransfer(edit: AgentQueueEdit): {apply: () => Promise<boolean>; release: () => void} | null;
  acquireOwner(): {controller: AgentInputQueueController<S, Q>; release: () => void} | null;
};
export interface AgentQueueAutoPrepareInput {
  readonly inputId: string;
  readonly text: string;
  readonly userInput?: readonly AgentUserInput[];
}
export declare function useAgentQueueAutoPrepare(running: boolean, queue: AgentQueueAutoPrepareInput | null,
  blocked: boolean, prepare: (input: AgentQueueAutoPrepareInput) => void | false): {readonly markQueued: () => void};
export declare function holdRejectedQueuePreparation(lease: {
  readonly controller: AgentInputQueueController<AgentWritingQueueScope, AgentWritingQueueResponse>;
  readonly release: () => void;
} | null, intent: AgentWritingQueuePreviewRequest, eligible?: () => boolean): Promise<void>;

interface RejectedSteerQueueOwner {
  getSnapshot(): {readonly queue: AgentQueueState | null};
  edit(edit: AgentQueueEdit, acknowledgment?: () => void, beforeSend?: undefined,
    expectedEpoch?: undefined, isAdmissionDisabled?: () => boolean): Promise<boolean>;
  reload(): Promise<void>;
}
interface RejectedSteerQueueLease {
  readonly controller: RejectedSteerQueueOwner;
  readonly release: () => void;
}
export declare function pauseRejectedSteerQueue(lease: RejectedSteerQueueLease | null): Promise<void>;
export declare function recoverRejectedSteer(lease: RejectedSteerQueueLease | null, request: {
  readonly inputId: string; readonly text: string; readonly userInput?: readonly AgentUserInput[];
}, acknowledge: () => void, isAdmissionDisabled?: () => boolean): Promise<boolean>;

export declare function readComposerCommand(text: string): {name: string; arguments: string} | null;
export declare const AGENT_START_FAILURE: "发送失败，消息已保留在输入框中，请检查后重新发送。";
export declare function recoverAgentPreparationFailure(options: {
  readonly text: string;
  readonly userInput?: readonly AgentUserInput[];
  readonly originalDraft: AgentInputDraft;
  readonly read: () => AgentInputDraft;
  readonly restore: (draft: AgentInputDraft) => void;
  readonly detail?: string;
  readonly failureMessage?: string;
  readonly notifyFailure?: boolean;
}): void;
export declare function dispatchQueuedAgentCommand(options: {
  readonly inputId: string;
  readonly text: string;
  readonly running: boolean;
  readonly execution?: Pick<AgentCommandExecution, "compact">;
  readonly transfer?: () => {apply: () => Promise<boolean>; release: () => void} | null;
  readonly executeQueued?: () => Promise<boolean>;
}): Promise<boolean | null>;

interface WritingQueuePresentationOwner {
  readonly phase: string;
  readonly error: unknown;
  readonly preparation?: {
    readonly phase: string; readonly recovered: boolean; readonly intent: {readonly inputId: string} | null;
  } | undefined;
  readonly startRecovery?: {
    readonly phase: string;
    readonly recovered: boolean;
    readonly turnId: string | null;
    readonly intent: {
      readonly inputId: string;
      readonly start: {readonly conversationId: string; readonly requestId: string};
    } | null;
    readonly result: {readonly conversationId: string; readonly requestId: string; readonly turnId: string} | null;
  } | undefined;
}
export declare function writingQueuePreparingPresentation(inputId: string | null | undefined,
  owner: WritingQueuePresentationOwner | null, activeDispatchInputId?: string | null): "none" | "sending" | "sent" | "recovery";
