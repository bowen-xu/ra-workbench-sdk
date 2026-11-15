import type {AgentTaskKind, AgentTurnOutcome, AgentUserInput} from "@research-assistant/core/agent";

export interface ChildCreationRecoveryIdentity {
  readonly conversationId: string;
  readonly turnId: string;
  readonly callId: string;
  readonly childId: string;
  readonly operationId: string;
  readonly watermark: number;
  readonly submissionRequestId?: string;
}

/** The existing journal-to-presentation projection. It grants no execution authority. */
export interface AgentMessage {
  readonly conversationId?: string;
  readonly userInput?: readonly AgentUserInput[];
  readonly content: string;
  readonly rawData?: unknown;
  readonly createdAt?: string;
  readonly failure?: boolean;
  readonly failureDiagnosticText?: string;
  readonly childCreationRecovery?: readonly (ChildCreationRecoveryIdentity & {
    readonly failureStage?: "creation" | "cleanup";
  })[];
  readonly unconfirmedToolReceiptIds?: readonly string[];
  readonly id: string;
  readonly renderKey?: string;
  readonly phase?: "commentary" | "reasoning" | "finalAnswer";
  readonly turnId?: string;
  readonly taskKind?: AgentTaskKind;
  readonly turnFinished?: boolean;
  readonly turnOutcome?: AgentTurnOutcome;
  readonly turnStartedAtMs?: number;
  readonly turnFinishedAtMs?: number;
  readonly reconnecting?: boolean;
  readonly reconnectAttempt?: number | undefined;
  readonly reconnectHistory?: readonly {
    readonly attemptId: string;
    readonly reason: string;
    readonly failedSeq?: number;
    readonly attemptIndex?: number;
  }[];
  readonly createdSeq?: number;
  readonly attemptIndex?: number;
  readonly kind?: "tool-call" | "tool-result" | "reasoning-summary" | "context-compaction" | "reconnect-anchor";
  readonly compaction?: {readonly operationId: string; readonly windowId: string | null};
  readonly reasoningSummaryParts?: readonly import("@research-assistant/core/agent").AgentReasoningSummaryTextPart[];
  readonly toolError?: boolean;
  readonly toolName?: string;
  readonly toolCallId?: string;
  readonly role: "assistant" | "user";
  readonly streaming?: boolean;
  readonly interrupted?: boolean;
}
export type WritingAgentMessage = AgentMessage;
