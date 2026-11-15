import { describe, expect, it } from "vitest";
import {
  AgentProjectionError, applyAgentEvents, createAgentConversationProjection, decodeAgentEvent,
  type AgentEvent, type AgentEventPayload,
} from "../../packages/core/src/agent";
import raw from "../fixtures/agent-events-v1.json";
const events = raw.map(decodeAgentEvent);
const conversationId = events[0].conversationId;
const turnId = events[0].payload.turnId;
const initial = () => createAgentConversationProjection(conversationId);
function event(seq: number, payload: AgentEventPayload): AgentEvent { return { ...events[0], seq, payload }; }

describe("agent presentation projection", () => {
  it("reconstructs shared native fixture with tool provenance, actual model and usage", () => {
    const start = initial();
    const partial = applyAgentEvents(start, events.slice(0, 3));
    const complete = applyAgentEvents(partial, events.slice(3));
    const turn = complete.turns.get(turnId)!;
    expect(start.seq).toBe(0);
    expect(start.turns.size).toBe(0);
    expect(partial.seq).toBe(3);
    expect(partial.turns.get(turnId)?.outcome).toBeNull();
    expect(complete.seq).toBe(events.at(-1)!.seq);
    expect(complete.activeTurn).toBeNull();
    expect(complete.turnOrder).toEqual([turnId, "00000000-0000-0000-0000-00000000003c"]);
    expect(complete.turns.get(complete.turnOrder[1]!)).toMatchObject({ outcome: "failed", failure: { error: "run budget exhausted", category: "admission" } });
    expect(turn.outcome).toBe("completed");
    const items = turn.itemOrder.map((id) => turn.items.get(id)!);
    expect(items.map((item) => item.text)).toEqual(["请检查稿件", "{}", "公开测试稿件", "检查完成。"]);
    expect(items[1].kind).toMatchObject({ type: "toolCall", providerCallId: "provider-call-1" });
    expect(items[2].kind).toMatchObject({ type: "toolResult", isError: false });
    expect(items[3]).toMatchObject({ phase: "finalAnswer", nativePhase: "finalAnswer" });
    expect(items.every((item) => item.completed && !item.interrupted)).toBe(true);
    expect([...turn.attempts.values()]).toEqual([{
      requestedModel: { providerId: "fixture", modelId: "agent-test", revision: null },
      actualModel: { providerId: "fixture", modelId: "agent-test-actual", revision: "2" },
      responseId: "response-1", outcome: "completed", inputTokens: 5, outputTokens: 2,
      error: null, retryable: null, failureCategory: null,
    }, {
      requestedModel: { providerId: "fixture", modelId: "agent-test", revision: null },
      actualModel: null, responseId: null, outcome: "completed", inputTokens: null, outputTokens: null,
      error: null, retryable: null, failureCategory: null,
    }]);
    expect([turn.inputTokens, turn.outputTokens]).toEqual([120, 30]);
    expect(applyAgentEvents(complete, events)).toBe(complete);
  });

  it("rejects gaps, foreign events and invalid batch tails without changing the starting state", () => {
    const state = applyAgentEvents(initial(), events.slice(0, 2));
    expect(() => applyAgentEvents(state, [events[3]])).toThrow(AgentProjectionError);
    expect(() => applyAgentEvents(state, [{ ...events[0], conversationId: "other" }])).toThrow("wrongConversation");
    expect(() => applyAgentEvents(state, [events[2], event(4, { type: "turnFinished", turnId, outcome: "completed" })])).toThrow("invalidTransition");
    expect(state.seq).toBe(2);
    expect([...state.turns.get(turnId)!.items.values()][0].text).toBe("");
    expect(applyAgentEvents(state, events.slice(2)).seq).toBe(events.at(-1)!.seq);
  });

  it.each(["failed", "canceled", "interrupted"] as const)("preserves partial items and unfinished model attempts on %s", (outcome) => {
    const state = applyAgentEvents(initial(), events.slice(0, 7));
    const next = applyAgentEvents(state, [
      event(8, { type: "itemStarted", turnId, itemId: "partial", kind: { type: "assistantMessage" } }),
      event(9, { type: "textDelta", turnId, itemId: "partial", text: "partial answer" }),
      event(10, { type: "turnFinished", turnId, outcome }),
    ]);
    const turn = next.turns.get(turnId)!;
    expect(turn.items.get("partial")).toMatchObject({ text: "partial answer", completed: false, interrupted: true });
    expect([...turn.attempts.values()][0].outcome).toBe(outcome);
    expect(next.activeTurn).toBeNull();
    expect(state.turns.get(turnId)?.outcome).toBeNull();
    expect(() => applyAgentEvents(next, [event(11, { type: "usage", turnId, inputTokens: 1, outputTokens: 1 })])).toThrow("invalidTransition");
  });

  it("requires completed calls before results and all results before successful completion", () => {
    const state = applyAgentEvents(initial(), events.slice(0, 10));
    const result = events[12].payload;
    expect(() => applyAgentEvents(state, [event(11, result)])).toThrow("invalidTransition");
    const called = applyAgentEvents(state, [events[10]]);
    expect(() => applyAgentEvents(called, [event(12, { type: "turnFinished", turnId, outcome: "completed" })])).toThrow("invalidTransition");
    const finished = applyAgentEvents(called, events.slice(11));
    expect(finished.turns.get(turnId)?.outcome).toBe("completed");
  });

  it("retains completed turns while adding a new turn and rejects reused item IDs", () => {
    const complete = applyAgentEvents(initial(), events);
    const nextId = "second";
    const first = events[0].payload;
    const next = applyAgentEvents(complete, [event(complete.seq + 1, { ...first, turnId: nextId })]);
    expect(next.turns.get(turnId)).toBe(complete.turns.get(turnId));
    expect(next.turnOrder).toEqual([...complete.turnOrder, nextId]);
    expect(next.activeTurn).toBe(nextId);
    expect(() => applyAgentEvents(next, [event(next.seq + 1, { ...events[1].payload, turnId: nextId })])).toThrow("invalidTransition");
  });
});
