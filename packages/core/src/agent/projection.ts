import type { AgentEvent, AgentFailureCategory, AgentTurnPhase } from "./events";
import { acceptAgentItem, placeAgentOutput } from "./projectionAcceptance";
import { advanceAgentReasoningSummary } from "./projectionReasoning";
import { rollbackAgentConversation } from "./projectionRollback";
import { AgentProjectionError, agentConversationRequiresToolRecovery, type AgentAttemptProjection, type AgentConversationProjection, type AgentTurnProjection } from "./projectionState";
export { AgentProjectionError, agentConversationRequiresToolRecovery, agentTurnUnconfirmedChildCreations } from "./projectionState";
export type { AgentItemProjection, AgentAttemptProjection, AgentTurnProjection, AgentConversationProjection } from "./projectionState";

function requireTransition(condition: unknown): asserts condition {
  if (!condition) throw new AgentProjectionError("invalidTransition");
}
const phases: Record<AgentTurnPhase, readonly AgentTurnPhase[]> = {
  preparing: ["runningModel", "awaitingInput"],
  runningModel: ["runningTools", "awaitingInput", "awaitingApproval"],
  runningTools: ["runningModel", "awaitingInput", "awaitingApproval"],
  awaitingInput: ["runningModel", "runningTools"],
  awaitingApproval: ["runningModel", "runningTools"],
};
export function createAgentConversationProjection(conversationId: string): AgentConversationProjection {
  return { conversationId: conversationId.toLowerCase(), seq: 0, activeTurn: null, turnOrder: [], turns: new Map() };
}

/** A failed retryable attempt is a live status, never a final error. A new
 * attempt or terminal event clears it. The native runner owns retry limits. */
export function agentTurnReconnecting(turn:AgentTurnProjection):boolean{
  if(turn.outcome!==null)return false;
  const id=turn.attemptOrder.at(-1);
  const attempt=id?turn.attempts.get(id):undefined;
  return attempt?.outcome==="failed"&&attempt.retryable===true;
}
export const AGENT_MODEL_MAX_RECONNECTS = 5;
/** A pending receipt is normal during execution; only a stopped turn needs a warning. */
export function agentTurnUnconfirmedReceipts(turn: AgentTurnProjection): readonly string[] {
  return turn.outcome === null ? [] : [...(turn.pendingToolReceipts ?? [])];
}
/** Consecutive failures since the latest output or completed request. */
export function agentTurnReconnectAttempt(turn: AgentTurnProjection): number | undefined {
  if (!agentTurnReconnecting(turn)) return undefined;
  let count = 0;
  for (const id of [...turn.attemptOrder].reverse()) {
    const attempt = turn.attempts.get(id);
    if (attempt?.outcome === "completed") break;
    if (attempt?.outcome === "failed" && attempt.retryable) count++;
    if (attempt?.hasOutput) break;
  }
  return Math.min(AGENT_MODEL_MAX_RECONNECTS, count);
}

/** Prefer the terminal diagnostic; legacy turns use an attempt error or fallback. */
export function agentTurnFailureReason(turn: AgentTurnProjection): string | undefined {
  // A model attempt may fail transiently and be retried within the same turn.
  // Until the durable turn reaches a failed terminal outcome there is no
  // user-visible Agent failure to report. In particular, a completed turn
  // must not retain an old attempt's diagnostic as a second failure message.
  if (turn.outcome !== "failed") return undefined;
  if (turn.failure) return turn.failure.error;
  const attemptOrder = turn.attemptOrder ?? [];
  const attempts = turn.attempts ?? new Map<string, AgentAttemptProjection>();
  for (let index = attemptOrder.length - 1; index >= 0; index -= 1) {
    const attemptId = attemptOrder[index];
    if (attemptId === undefined) continue;
    const attempt = attempts.get(attemptId);
    if (attempt?.outcome === "failed" && attempt.error !== null) return attempt.error;
  }
  return "本轮未能完成。请重试；如果持续失败，请检查 Agent 配置和工具状态。";
}

/** Prefer the terminal category, with legacy model-attempt compatibility. */
export function agentTurnFailureCategory(turn: AgentTurnProjection): AgentFailureCategory | undefined {
  if (turn.outcome !== "failed") return undefined;
  if (turn.failure) return turn.failure.category;
  const attemptOrder = turn.attemptOrder ?? [];
  const attempts = turn.attempts ?? new Map<string, AgentAttemptProjection>();
  for (let index = attemptOrder.length - 1; index >= 0; index -= 1) {
    const attemptId = attemptOrder[index];
    if (attemptId === undefined) continue;
    const attempt = attempts.get(attemptId);
    if (attempt?.outcome === "failed" && attempt.failureCategory !== null) return attempt.failureCategory;
  }
  return undefined;
}

/** Apply already-decoded durable events atomically. Gaps require history recovery.
 * Duplicate sequence numbers are ignored as in the native immutable journal.
 * The input state and previously returned snapshots remain unchanged on success or failure. */
export function applyAgentEvents(state: AgentConversationProjection, events: readonly AgentEvent[]): AgentConversationProjection {
  return events.reduce(applyEvent, state);
}
function applyEvent(state: AgentConversationProjection, event: AgentEvent): AgentConversationProjection {
  if (event.conversationId !== state.conversationId) throw new AgentProjectionError("wrongConversation");
  if (event.seq <= state.seq) return state;
  if (event.seq !== state.seq + 1) throw new AgentProjectionError("gap");
  const payload = event.payload;
  const turnId = payload.turnId;
  if (payload.type === "conversationRolledBack") {
    return { ...rollbackAgentConversation(state, payload), seq: event.seq };
  }
  if (payload.type === "turnStarted") {
    requireTransition(!agentConversationRequiresToolRecovery(state));
    requireTransition(state.activeTurn === null && !state.turns.has(turnId) && !state.rolledBackTurnIds?.has(turnId));
    const turn: AgentTurnProjection = {
      taskKind: payload.taskKind ?? "regular",
      contextSnapshotId: payload.contextSnapshotId, model: payload.model, startedAtMs: event.timestampMs,
      phase: "preparing", outcome: null,
      itemOrder: [], items: new Map(), attemptOrder: [], attempts: new Map(), inputTokens: null, outputTokens: null,
    };
    return { ...state, seq: event.seq, activeTurn: turnId, turnOrder: [...state.turnOrder, turnId], turns: new Map(state.turns).set(turnId, turn) };
  }
  requireTransition(state.activeTurn === turnId);
  const current = state.turns.get(turnId);
  requireTransition(current);
  requireTransition(current.failure === undefined || payload.type === "turnFinished");
  let turn = current;
  switch (payload.type) {
    case "childCreationPrepared": {
      const intents = turn.childCreationIntents ?? new Map();
      requireTransition(!intents.has(payload.callId)
        && ![...state.turns.values()].some(previous => [...(previous.childCreationIntents?.values() ?? [])]
          .some(intent => intent.childId === payload.childId || intent.operationId === payload.operationId))
        && [...turn.items.values()].some(item => item.accepted && item.completed && item.kind.type === "toolCall"
          && item.kind.callId === payload.callId && item.kind.name === "research_spawn_subtask" && item.kind.namespace === undefined && item.kind.providerCallId !== undefined)
        && ![...turn.items.values()].some(item => item.kind.type === "toolResult" && item.kind.callId === payload.callId));
      turn = { ...turn, childCreationIntents: new Map(intents).set(payload.callId, { childId: payload.childId, operationId: payload.operationId, binding: payload.binding, ...(payload.version === 2 ? { submissionRequestId: payload.submissionRequestId } : {}) }) };
      break;
    }
    case "toolReceiptPending": {
      requireTransition(!turn.pendingToolReceipts?.has(payload.callId)
        && [...turn.items.values()].some(item => item.completed && item.kind.type === "toolCall" && item.kind.callId === payload.callId)
        && ![...turn.items.values()].some(item => item.kind.type === "toolResult" && item.kind.callId === payload.callId));
      turn = { ...turn, pendingToolReceipts: new Set([...(turn.pendingToolReceipts ?? []), payload.callId]) };
      break;
    }
    case "toolReceiptConfirmed": {
      requireTransition(turn.pendingToolReceipts?.has(payload.callId)
        && [...turn.items.values()].some(item => item.completed && item.kind.type === "toolResult" && item.kind.callId === payload.callId));
      const pendingToolReceipts = new Set(turn.pendingToolReceipts);
      pendingToolReceipts.delete(payload.callId);
      turn = { ...turn, pendingToolReceipts };
      break;
    }
    case "phaseChanged":
      requireTransition(turn.phase === payload.phase || phases[turn.phase].includes(payload.phase));
      turn = { ...turn, phase: payload.phase };
      break;
    case "itemStarted": {
      requireTransition(!state.rolledBackItemIds?.has(payload.itemId)
        && ![...state.turns.values()].some((value) => value.items.has(payload.itemId)));
      const kind = payload.kind;
      requireTransition(kind.type !== "hookPrompt" && kind.type !== "providerNative");
      const items = [...turn.items.values()];
      if (kind.type === "toolCall") {
        requireTransition(!items.some((item) => item.kind.type === "toolCall" && (item.kind.callId === kind.callId
          || (kind.providerCallId !== undefined && kind.providerCallId === item.kind.providerCallId))));
      } else if (kind.type === "toolResult") {
        requireTransition(items.some((item) => item.completed && item.kind.type === "toolCall" && item.kind.callId === kind.callId));
        requireTransition(!items.some((item) => item.kind.type === "toolResult" && item.kind.callId === kind.callId));
      }
      const attemptId = kind.type === "assistantMessage" || kind.type === "reasoningSummary" ? turn.attemptOrder.at(-1) : undefined;
      if (kind.type === "reasoningSummary") requireTransition(kind.parts.length === 0 && attemptId && turn.attempts.get(attemptId)?.outcome === null);
      const orderingAttempt = attemptId && turn.attempts.get(attemptId)?.outcome === null ? attemptId : undefined;
      turn = { ...turn, itemOrder: placeAgentOutput(turn, payload.itemId, orderingAttempt), items: new Map(turn.items).set(payload.itemId, { kind, createdAtMs: event.timestampMs, createdSeq: event.seq, text: "", completed: false, interrupted: false,
        ...(attemptId === undefined ? {} : { attemptId }) }) };
      break;
    }
    case "textDelta": case "itemCompleted": {
      const item = turn.items.get(payload.itemId);
      requireTransition(item && !item.completed && !item.interrupted);
      requireTransition(item.kind.type !== "reasoningSummary" && (payload.type !== "textDelta" || item.kind.type !== "contextCompaction"));
      const next = payload.type === "textDelta" ? { ...item, text: item.text + payload.text } : { ...item, completed: true };
      turn = { ...turn, items: new Map(turn.items).set(payload.itemId, next) };
      if (payload.type === "textDelta" && payload.text && item.kind.type === "assistantMessage") {
        const attemptId = turn.attemptOrder.at(-1);
        const attempt = attemptId ? turn.attempts.get(attemptId) : undefined;
        if (attemptId && attempt?.outcome === null) {
          turn = { ...turn, attempts: new Map(turn.attempts).set(attemptId, { ...attempt, hasOutput: true }) };
        }
      }
      break;
    }
    case "reasoningSummaryPartAdded": case "reasoningSummaryDelta":
      turn = advanceAgentReasoningSummary(turn, payload);
      break;
    case "itemAccepted": {
      requireTransition(!state.rolledBackItemIds?.has(payload.itemId)
        && ![...state.turns].some(([id, value]) => id !== turnId && value.items.has(payload.itemId)));
      turn = acceptAgentItem(turn, payload, event.timestampMs, event.seq);
      break;
    }
    case "itemPhaseChanged": {
      const item = turn.items.get(payload.itemId);
      requireTransition(item && !item.completed && !item.interrupted && item.kind.type === "assistantMessage" && item.phase === undefined);
      turn = { ...turn, items: new Map(turn.items).set(payload.itemId, { ...item, phase: payload.phase,
        ...(payload.native ? { nativePhase: payload.phase } : {}) }) };
      break;
    }
    case "modelOutputOrder": {
      const tail = turn.itemOrder.slice(-payload.itemIds.length);
      requireTransition(tail.length === payload.itemIds.length && new Set(payload.itemIds).size === payload.itemIds.length
        && payload.itemIds.every(id => tail.includes(id)));
      for (const id of payload.itemIds) {
        const item = turn.items.get(id);
        requireTransition(!turn.orderedOutputItems?.has(id) && item && item.completed && !item.interrupted && item.source === undefined
          && (item.kind.type === "assistantMessage" || item.kind.type === "toolCall"));
      }
      turn = { ...turn, itemOrder: [...turn.itemOrder.slice(0, -payload.itemIds.length), ...payload.itemIds],
        orderedOutputItems: new Set([...(turn.orderedOutputItems ?? []), ...payload.itemIds]) };
      break;
    }
    case "modelRequestStarted":
      requireTransition(turn.phase === "runningModel" && !turn.attempts.has(payload.attemptId)
        && ![...turn.attempts.values()].some((attempt) => attempt.outcome === null));
      turn = { ...turn, attemptOrder: [...turn.attemptOrder, payload.attemptId], attempts: new Map(turn.attempts).set(payload.attemptId, {
        requestedModel: payload.model, actualModel: null, responseId: null, outcome: null, inputTokens: null, outputTokens: null,
        error: null, retryable: null,
        failureCategory: null,
      }) };
      break;
    case "modelOutputInterleavingStarted": {
      const attempt = turn.attempts.get(payload.attemptId);
      requireTransition(attempt && attempt.outcome === null && attempt.responseId === null && !attempt.interleavedToolResults);
      requireTransition(![...turn.items.values()].some(item => item.attemptId === payload.attemptId || item.source?.attemptId === payload.attemptId));
      turn = { ...turn, attempts: new Map(turn.attempts).set(payload.attemptId, { ...attempt, interleavedToolResults: true }) };
      break;
    }
    case "modelIdentityObserved": case "modelResponseStarted": case "modelRequestFinished": case "modelCompactionFinished": case "modelRequestFailed": {
      const attempt = turn.attempts.get(payload.attemptId);
      requireTransition(attempt && attempt.outcome === null);
      let next: AgentAttemptProjection;
      if (payload.type === "modelResponseStarted") {
        requireTransition(attempt.responseId === null && (payload.model === null || attempt.requestedModel.providerId === payload.model.providerId));
        next = { ...attempt, responseId: payload.responseId, actualModel: payload.model };
      } else if (payload.type === "modelIdentityObserved") {
        requireTransition(attempt.responseId !== null && attempt.requestedModel.providerId === payload.model.providerId);
        next = { ...attempt, actualModel: payload.model };
      } else if (payload.type === "modelRequestFinished" || payload.type === "modelCompactionFinished") {
        requireTransition(payload.type === "modelCompactionFinished" ? attempt.responseId === null : attempt.responseId !== null);
        next = { ...attempt, outcome: "completed", inputTokens: payload.inputTokens, outputTokens: payload.outputTokens };
      } else {
        next = { ...attempt, outcome: "failed", error: payload.error, retryable: payload.retryable, failureCategory: payload.category, failedSeq: event.seq };
        turn = { ...turn, items: new Map([...turn.items].map(([id, item]) => [id,
          !item.completed && (item.kind.type === "assistantMessage"
            || (item.kind.type === "reasoningSummary" && item.attemptId === payload.attemptId)) ? { ...item, interrupted: true } : item])) };
      }
      turn = { ...turn, attempts: new Map(turn.attempts).set(payload.attemptId, next) };
      break;
    }
    case "usage":
      requireTransition(payload.inputTokens === null || turn.inputTokens === null || payload.inputTokens >= turn.inputTokens);
      requireTransition(payload.outputTokens === null || turn.outputTokens === null || payload.outputTokens >= turn.outputTokens);
      turn = { ...turn, inputTokens: payload.inputTokens, outputTokens: payload.outputTokens };
      break;
    case "turnFailed":
      requireTransition(turn.failure === undefined);
      turn = { ...turn, failure: { error: payload.error, category: payload.category } };
      break;
    case "turnFinished": {
      requireTransition(turn.failure === undefined || payload.outcome === "failed");
      const items = [...turn.items.values()];
      if (payload.outcome === "completed") {
        requireTransition((turn.pendingToolReceipts?.size ?? 0) === 0);
        requireTransition([...turn.attempts.values()].every((attempt) => attempt.outcome !== null));
        requireTransition(items.every((item) => item.completed || (item.interrupted && (item.kind.type === "assistantMessage" || item.kind.type === "reasoningSummary"))));
        requireTransition(items.every((item) => {
          const kind = item.kind;
          return kind.type !== "toolCall" || items.some((result) => result.completed && result.kind.type === "toolResult" && result.kind.callId === kind.callId);
        }));
      }
      turn = { ...turn, outcome: payload.outcome, finishedAtMs: event.timestampMs,
        items: new Map([...turn.items].map(([id, item]) => [id, item.completed ? item : { ...item, interrupted: true }])),
        attempts: new Map([...turn.attempts].map(([id, attempt]) => [id, attempt.outcome !== null ? attempt : { ...attempt, outcome: payload.outcome }])),
      };
      break;
    }
    default: { const exhaustive: never = payload; return exhaustive; }
  }
  return { ...state, seq: event.seq, activeTurn: turn.outcome === null ? turnId : null, turns: new Map(state.turns).set(turnId, turn) };
}
