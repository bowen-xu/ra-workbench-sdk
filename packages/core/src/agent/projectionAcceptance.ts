import type { AgentEventPayload } from "./events";
import { AgentProjectionError, type AgentTurnProjection } from "./projectionState";

function requireValid(condition: unknown): asserts condition {
  if (!condition) throw new AgentProjectionError("invalidTransition");
}

export function placeAgentOutput(turn: AgentTurnProjection, itemId: string, attemptId?: string): readonly string[] {
  const remaining = turn.itemOrder.filter(id => id !== itemId);
  const beforeResult = attemptId && turn.attempts.get(attemptId)?.interleavedToolResults ? remaining.findIndex(id => {
    const result = turn.items.get(id);
    if (result?.kind.type !== "toolResult") return false;
    const callId = result.kind.callId;
    return [...turn.items.values()].some(item => item.kind.type === "toolCall" && item.kind.callId === callId && item.source?.attemptId === attemptId);
  }) : -1;
  const index = beforeResult < 0 ? remaining.length : beforeResult;
  return [...remaining.slice(0, index), itemId, ...remaining.slice(index)];
}

/** A canonical item is a single acceptance, including a streamed draft's completion. */
export function acceptAgentItem(turn: AgentTurnProjection, payload: Extract<AgentEventPayload, { type: "itemAccepted" }>, timestampMs: number, eventSeq: number): AgentTurnProjection {
  const { itemId, kind, source, phase, text } = payload;
  const old = turn.items.get(itemId);
  if (old) {
    requireValid(!old.completed && !old.interrupted);
    if (source && kind.type === "assistantMessage" && old.kind.type === "assistantMessage") {
      // A done snapshot may correct its own live draft, never another attempt.
      requireValid(old.attemptId === source.attemptId);
    } else {
      requireValid(kind.type === "reasoningSummary" ? old.kind.type === "reasoningSummary"
        : JSON.stringify(old.kind) === JSON.stringify(kind) && old.text === text);
      requireValid(old.nativePhase === undefined || phase === null || old.nativePhase === phase);
    }
  }
  if (source) {
    const attempt = turn.attempts.get(source.attemptId);
    const previous = [...turn.items.values()].flatMap(item => item.source?.attemptId === source.attemptId ? [item.source] : []);
    requireValid(attempt?.outcome === null && attempt.responseId !== null && source.ordinal === previous.length
      && !previous.some(item => source.providerItemId !== null && source.providerItemId === item.providerItemId)
      && (kind.type === "assistantMessage" || kind.type === "toolCall" || kind.type === "providerNative" || kind.type === "reasoningSummary"));
  }
  if (kind.type === "toolCall") {
    requireValid(![...turn.items].some(([id, item]) => id !== itemId && item.kind.type === "toolCall"
      && (item.kind.callId === kind.callId || (kind.providerCallId !== undefined && item.kind.providerCallId === kind.providerCallId))));
  } else if (kind.type === "toolResult") {
    requireValid([...turn.items.values()].some(item => item.completed && item.kind.type === "toolCall" && item.kind.callId === kind.callId));
    requireValid(![...turn.items].some(([id, item]) => id !== itemId && item.kind.type === "toolResult" && item.kind.callId === kind.callId));
  } else if (kind.type === "providerNative") {
    requireValid(!old && source?.providerDataJson && text === "" && phase === null);
  } else if (kind.type === "reasoningSummary") {
    requireValid(phase === null && (!source || !old?.attemptId || old.attemptId === source.attemptId));
  } else if (kind.type === "hookPrompt") {
    requireValid(!old && text === "" && phase === null && source === null);
  } else requireValid(kind.type === "assistantMessage");
  const resolvedPhase = phase ?? old?.phase;
  const nativePhase = phase ?? old?.nativePhase;
  const attemptId = source?.attemptId ?? old?.attemptId;
  // A canonical completion cannot replace the first draft time. Older cached
  // projections lacking it remain unknown until a full history replay.
  const createdAtMs = old ? old.createdAtMs : timestampMs;
  const createdSeq = old ? old.createdSeq : eventSeq;
  const itemOrder = source || !turn.itemOrder.includes(itemId) ? placeAgentOutput(turn, itemId, source?.attemptId) : turn.itemOrder;
  return { ...turn, itemOrder,
    items: new Map(turn.items).set(itemId, { kind, text, completed: true, interrupted: false, accepted: true,
      ...(createdAtMs === undefined ? {} : { createdAtMs }),
      ...(createdSeq === undefined ? {} : { createdSeq }),
      ...(resolvedPhase ? { phase: resolvedPhase } : {}), ...(nativePhase ? { nativePhase } : {}), ...(source ? { source } : {}),
      ...(attemptId ? { attemptId } : {}) }) };
}
