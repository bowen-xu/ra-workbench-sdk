import type { AgentEventPayload } from "./events";
import { AgentProjectionError, type AgentTurnProjection } from "./projectionState";
import { AGENT_REASONING_SUMMARY_MAX_BYTES } from "./reasoningSummary";
import { utf8Length } from "./workspaceDecoding";

type Progress = Extract<AgentEventPayload, { type: "reasoningSummaryPartAdded" | "reasoningSummaryDelta" }>;

/** Progress belongs to one active model item's ordered parts, never another attempt. */
export function advanceAgentReasoningSummary(turn: AgentTurnProjection, payload: Progress): AgentTurnProjection {
  const item = turn.items.get(payload.itemId);
  const attempt = item?.attemptId ? turn.attempts.get(item.attemptId) : undefined;
  if (!item || item.kind.type !== "reasoningSummary" || item.completed || item.interrupted
    || !item.attemptId || attempt?.outcome !== null || turn.attemptOrder.at(-1) !== item.attemptId) throw new AgentProjectionError("invalidTransition");
  const draft = new Map(item.reasoningSummaryDraft);
  const newPart = !draft.has(payload.summaryIndex);
  const old = draft.get(payload.summaryIndex) ?? "";
  draft.set(payload.summaryIndex, payload.type === "reasoningSummaryDelta" ? old + payload.text : old);
  const text = [...draft.values()].join("");
  if (utf8Length(text) > AGENT_REASONING_SUMMARY_MAX_BYTES
    || (newPart && utf8Length(JSON.stringify([...draft.keys()])) > AGENT_REASONING_SUMMARY_MAX_BYTES)) throw new AgentProjectionError("invalidTransition");
  return { ...turn, items: new Map(turn.items).set(payload.itemId, { ...item, text, reasoningSummaryDraft: draft }),
    ...(payload.type === "reasoningSummaryDelta" ? { attempts: new Map(turn.attempts).set(item.attemptId, { ...attempt, hasOutput: true }) } : {}) };
}
