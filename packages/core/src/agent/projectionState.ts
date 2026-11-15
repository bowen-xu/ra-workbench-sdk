import type { AgentAssistantMessagePhase, AgentCanonicalItemSource, AgentFailureCategory, AgentItemKind, AgentModelIdentity, AgentTurnOutcome, AgentTurnPhase } from "./events";

/** Presentation counterpart of agent-core/protocol/projection.rs. No effects or execution authority. */
export interface AgentItemProjection {
  readonly kind: AgentItemKind;
  /** Sequence of the first durable item event, absent in older cached snapshots. */
  readonly createdSeq?: number;
  /** First durable item event; absent in older hand-built presentation snapshots. */
  readonly createdAtMs?: number;
  readonly phase?: AgentAssistantMessagePhase;
  /** Native provider metadata, kept separate from legacy display inference. */
  readonly nativePhase?: AgentAssistantMessagePhase;
  readonly source?: AgentCanonicalItemSource;
  /** Derived from the active sample when a draft starts; never guessed from text. */
  readonly attemptId?: string;
  /** Set by atomic ItemAccepted, absent on legacy split records. */
  readonly accepted?: boolean;
  readonly text: string;
  /** Draft-only public parts in first-seen order; canonical acceptance clears it. */
  readonly reasoningSummaryDraft?: ReadonlyMap<string, string>;
  readonly completed: boolean;
  readonly interrupted: boolean;
}
export interface AgentAttemptProjection {
  readonly interleavedToolResults?: boolean;
  readonly hasOutput?: boolean;
  /** Durable failure event position, absent in older cached snapshots. */
  readonly failedSeq?: number;
  readonly requestedModel: AgentModelIdentity;
  readonly actualModel: AgentModelIdentity | null;
  readonly responseId: string | null;
  readonly outcome: AgentTurnOutcome | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly error: string | null;
  readonly retryable: boolean | null;
  readonly failureCategory: AgentFailureCategory | null;
}
export interface AgentTurnProjection {
  readonly failure?: { readonly error: string; readonly category: AgentFailureCategory };
  /** Missing in pre-task-kind snapshots; interpreted as regular. */
  readonly taskKind?: "regular" | "compact";
  readonly contextSnapshotId: string;
  readonly model: AgentModelIdentity;
  /** Durable wall-clock start captured from the turnStarted event. */
  readonly startedAtMs?: number;
  /** Presentation timing from the durable terminal event, never a running clock. */
  readonly finishedAtMs?: number;
  readonly phase: AgentTurnPhase;
  readonly outcome: AgentTurnOutcome | null;
  readonly itemOrder: readonly string[];
  /** Response ordering is recorded once; absent for legacy snapshots. */
  readonly orderedOutputItems?: ReadonlySet<string>;
  readonly items: ReadonlyMap<string, AgentItemProjection>;
  readonly pendingToolReceipts?: ReadonlySet<string>;
  readonly childCreationIntents?: ReadonlyMap<string, { readonly childId: string; readonly operationId: string; readonly submissionRequestId?: string; readonly binding: { readonly kind: "manuscript" | "paper" | "note" | "readingNote"; readonly resourceId: string } }>;
  readonly attemptOrder: readonly string[];
  readonly attempts: ReadonlyMap<string, AgentAttemptProjection>;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
}
export interface AgentConversationProjection {
  readonly conversationId: string;
  readonly seq: number;
  readonly activeTurn: string | null;
  readonly turnOrder: readonly string[];
  readonly turns: ReadonlyMap<string, AgentTurnProjection>;
  /** Rollback hides turns, but their durable identities must never be reused. */
  readonly rolledBackTurnIds?: ReadonlySet<string>;
  readonly rolledBackItemIds?: ReadonlySet<string>;
}
export class AgentProjectionError extends Error {
  constructor(readonly code: "wrongConversation" | "gap" | "invalidTransition") {
    super(`Agent projection: ${code}`); this.name = "AgentProjectionError";
  }
}

/** Saved creation intent is evidence only while its accepted call lacks a result. */
export function agentTurnUnconfirmedChildCreations(turn: AgentTurnProjection): readonly { readonly callId: string; readonly childId: string; readonly operationId: string; readonly submissionRequestId?: string }[] {
  if (turn.outcome === null) return [];
  return [...(turn.childCreationIntents ?? [])].flatMap(([callId, intent]) => {
    const call = [...turn.items.values()].find(item => item.accepted && item.completed && item.kind.type === "toolCall"
      && item.kind.callId === callId && item.kind.name === "research_spawn_subtask" && item.kind.providerCallId !== undefined && item.kind.namespace === undefined);
    const result = [...turn.items.values()].some(item => item.completed && item.kind.type === "toolResult" && item.kind.callId === callId);
    return call && !result ? [{callId, childId: intent.childId, operationId: intent.operationId, ...(intent.submissionRequestId ? {submissionRequestId: intent.submissionRequestId} : {})}] : [];
  });
}

/** Unknown external effects cannot be erased by opening another model turn. */
export function agentConversationRequiresToolRecovery(state: AgentConversationProjection): boolean {
  return [...state.turns.values()].some(turn => (turn.pendingToolReceipts?.size ?? 0) > 0 || turn.outcome !== null
    && [...turn.items.values()].some(item => (item.accepted || turn.failure?.category === "recovery") && item.completed && item.kind.type === "toolCall"
      && ![...turn.items.values()].some(result => result.completed && result.kind.type === "toolResult"
        && item.kind.type === "toolCall" && result.kind.callId === item.kind.callId)));
}

