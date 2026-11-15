import { expect, it } from "vitest";
import { applyAgentEvents, createAgentConversationProjection } from "./projection";
import type { AgentEvent } from "./events";

it("records terminal time from history instead of the viewer's clock", () => {
  const conversationId = "11111111-1111-4111-8111-111111111111";
  const turnId = "22222222-2222-4222-8222-222222222222";
  const envelope = { schemaVersion: 1 as const, conversationId, requestId: "44444444-4444-4444-8444-444444444444" };
  const started: AgentEvent = { ...envelope, seq: 1, timestampMs: 1_000,
    payload: { type: "turnStarted", turnId, contextSnapshotId: "33333333-3333-4333-8333-333333333333",
      model: { providerId: "mock", modelId: "mock", revision: "1" } } };
  const finished: AgentEvent = { ...envelope, seq: 2, timestampMs: 8_800,
    payload: { type: "turnFinished", turnId, outcome: "completed" } };
  const projection = applyAgentEvents(createAgentConversationProjection(conversationId), [started, finished]);
  expect(projection.turns.get(turnId)).toMatchObject({ startedAtMs: 1_000, finishedAtMs: 8_800 });
});
