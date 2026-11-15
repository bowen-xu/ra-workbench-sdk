import { describe, expect, it } from "vitest";
import { decodeAgentEvent, type AgentEventPayload, type AgentEvent } from "./events";
import { applyAgentEvents, createAgentConversationProjection } from "./projection";

const conversationId = "11111111-1111-4111-8111-111111111111";
const turnId = "22222222-2222-4222-8222-222222222222";
const first = "33333333-3333-4333-8333-333333333333";
const last = "44444444-4444-4444-8444-444444444444";
const tool = "55555555-5555-4555-8555-555555555555";
const callId = "66666666-6666-4666-8666-666666666666";
const model = { providerId: "fixture", modelId: "fixture", revision: null };
function events(payloads: readonly AgentEventPayload[]): AgentEvent[] {
  return payloads.map((payload, index) => decodeAgentEvent({ schemaVersion: 1, conversationId,
    seq: index + 1, timestampMs: index + 1, requestId: turnId, payload }));
}
function history(): AgentEventPayload[] {
  return [
    { type: "turnStarted", turnId, contextSnapshotId: first, model },
    { type: "phaseChanged", turnId, phase: "runningModel" },
    { type: "itemStarted", turnId, itemId: first, kind: { type: "assistantMessage" } },
    { type: "itemPhaseChanged", turnId, itemId: first, phase: "commentary", native: true },
    { type: "textDelta", turnId, itemId: first, text: "Checking" },
    { type: "itemCompleted", turnId, itemId: first },
    { type: "itemStarted", turnId, itemId: last, kind: { type: "assistantMessage" } },
    { type: "textDelta", turnId, itemId: last, text: "Result" },
    { type: "itemCompleted", turnId, itemId: last },
    { type: "phaseChanged", turnId, phase: "runningTools" },
    { type: "itemStarted", turnId, itemId: tool, kind: { type: "toolCall", callId, name: "read" } },
    { type: "textDelta", turnId, itemId: tool, text: "{}" },
    { type: "itemCompleted", turnId, itemId: tool },
  ];
}

describe("validated native output order", () => {
  it("replays provider message/tool order while retaining native phase provenance", () => {
    const projection = applyAgentEvents(createAgentConversationProjection(conversationId), events([
      ...history(), { type: "modelOutputOrder", turnId, itemIds: [first, tool, last] },
    ]));
    const turn = projection.turns.get(turnId)!;
    expect(turn.itemOrder).toEqual([first, tool, last]);
    expect(turn.items.get(first)).toMatchObject({ phase: "commentary", nativePhase: "commentary" });
    expect(turn.items.get(last)?.nativePhase).toBeUndefined();
  });

  it("keeps legacy display phase separate from native metadata", () => {
    const payloads = history().map(payload => payload.type === "itemPhaseChanged"
      ? { type: payload.type, turnId, itemId: payload.itemId, phase: payload.phase } : payload);
    const projection = applyAgentEvents(createAgentConversationProjection(conversationId), events(payloads));
    expect(projection.turns.get(turnId)?.items.get(first)?.phase).toBe("commentary");
    expect(projection.turns.get(turnId)?.items.get(first)?.nativePhase).toBeUndefined();
  });

  it("rejects duplicates, unknown identities and crossing an earlier item", () => {
    for (const itemIds of [[first, first, tool], [first, last, callId], [first]]) {
      expect(() => applyAgentEvents(createAgentConversationProjection(conversationId), events([
        ...history(), { type: "modelOutputOrder", turnId, itemIds },
      ]))).toThrow();
    }
    expect(() => applyAgentEvents(createAgentConversationProjection(conversationId), events([
      ...history(), { type: "modelOutputOrder", turnId, itemIds: [first, tool, last] },
      { type: "modelOutputOrder", turnId, itemIds: [first, last, tool] },
    ]))).toThrow();
  });
});
