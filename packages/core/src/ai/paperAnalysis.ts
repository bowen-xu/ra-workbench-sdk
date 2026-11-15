import type { LlmReasoningEffort } from "./llmReasoning";

export type PaperAnalysisWorkflowStatus =
  | "preparing" | "overview_running" | "overview_ready" | "concepts_running"
  | "needs_review" | "partial" | "failed" | "canceled" | "superseded";
export type PaperAnalysisTurnKind = "paper_overview" | "paper_concept_map";
export type PaperAnalysisTurnStatus =
  | "queued" | "running" | "succeeded" | "failed" | "canceled" | "interrupted";
export type PaperAnalysisMessageKind =
  | "system_context" | "task_prompt" | "assistant_candidate" | "transition";

export interface PaperAnalysisMessage {
  readonly kind: PaperAnalysisMessageKind;
  readonly content: string;
  readonly sourceTurnId?: string;
}

export interface PaperAnalysisAttempt {
  readonly id: string;
  readonly turnId: string;
  readonly sharedConversationId?: string;
  readonly sharedRequestId?: string;
  readonly sharedTurnId?: string;
  readonly sharedTurnOutcome?: "completed" | "failed" | "canceled" | "interrupted";
  readonly sharedAiRunId?: string;
  readonly sharedCandidateId?: string;
  readonly sharedTerminalStatus?: string;
  readonly attempt: number;
  readonly status: PaperAnalysisTurnStatus;
  readonly normalizedMessages: readonly PaperAnalysisMessage[];
  readonly providerId: string;
  readonly modelId: string;
  readonly reasoningEffort?: LlmReasoningEffort;
  readonly aiRunId?: string;
  readonly candidateId?: string;
  readonly inputHash?: string;
  readonly outputHash?: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly errorCode?: string;
  readonly errorMessage?: string;
  readonly createdAt: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
  readonly recoveryReason?: string;
  readonly recoveryVersion?: number;
  readonly recoveredAt?: string;
}

export interface PaperAnalysisTurn {
  readonly id: string;
  readonly workflowId: string;
  readonly ordinal: number;
  readonly kind: PaperAnalysisTurnKind;
  readonly status: PaperAnalysisTurnStatus;
  readonly candidateId?: string;
  readonly createdAt: string;
  readonly finishedAt?: string;
  readonly attempts: readonly PaperAnalysisAttempt[];
}

export interface PaperAnalysisWorkflow {
  readonly id: string;
  readonly conversationId?: string;
  readonly activeClientRequestId?: string;
  readonly paperId: string;
  readonly contextSnapshotId: string;
  readonly status: PaperAnalysisWorkflowStatus;
  readonly providerId: string;
  readonly modelId: string;
  readonly reasoningEffort?: LlmReasoningEffort;
  readonly promptSetVersion: string;
  readonly activeTurnKind?: PaperAnalysisTurnKind;
  readonly revision: number;
  readonly supersedesWorkflowId?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt?: string;
  readonly turns: readonly PaperAnalysisTurn[];
}

