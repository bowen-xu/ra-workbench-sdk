import { expect, it } from "vitest";
import { decodeAgentEvent, type AgentEventPayload } from "./events";
import { agentConversationRequiresToolRecovery, applyAgentEvents, createAgentConversationProjection } from "./projection";
import childCreationFixture from "../../../../tests/fixtures/agent-child-creation-v1.json";
import childCreationFixtureV2 from "../../../../tests/fixtures/agent-child-creation-v2.json";

it("decodes the shared Rust child creation event without changing its binding", () => {
  expect(decodeAgentEvent(childCreationFixture)).toEqual(childCreationFixture);
  expect(decodeAgentEvent(childCreationFixtureV2)).toEqual(childCreationFixtureV2);
});

const conversationId = "11111111-1111-4111-8111-111111111111";
const turnId = "22222222-2222-4222-8222-222222222222";
const callId = "33333333-3333-4333-8333-333333333333";
const callItem = "44444444-4444-4444-8444-444444444444";
const resultItem = "55555555-5555-4555-8555-555555555555";
const model = { providerId: "test", modelId: "test", revision: null };
function project(payloads: AgentEventPayload[]) {
  return applyAgentEvents(createAgentConversationProjection(conversationId), payloads.map((payload, i) => decodeAgentEvent({
    schemaVersion: 1, conversationId, seq: i + 1, timestampMs: 1, requestId: turnId, payload,
  })));
}
const prefix: AgentEventPayload[] = [
  { type: "turnStarted", turnId, contextSnapshotId: turnId, model },
  { type: "itemAccepted", turnId, itemId: callItem, kind: { type: "toolCall", callId, name: "read" }, text: "{}", phase: null, source: null },
  { type: "toolReceiptPending", turnId, callId },
];
const result: AgentEventPayload[] = [
  { type: "itemStarted", turnId, itemId: resultItem, kind: { type: "toolResult", callId } },
  { type: "itemCompleted", turnId, itemId: resultItem },
];
it("retains pending delivery after an interrupted turn even when its result exists", () => {
  const interrupted = project([...prefix, ...result, { type: "turnFinished", turnId, outcome: "interrupted" }]);
  expect(agentConversationRequiresToolRecovery(interrupted)).toBe(true);
  expect(interrupted.turns.get(turnId)?.pendingToolReceipts?.has(callId)).toBe(true);
  expect(() => project([...prefix, ...result, { type: "turnFinished", turnId, outcome: "completed" }])).toThrow();
});
it("requires the original completed result before acknowledging and preserves old histories", () => {
  expect(() => project([...prefix, { type: "toolReceiptConfirmed", turnId, callId }])).toThrow();
  const confirmed = project([...prefix, ...result, { type: "toolReceiptConfirmed", turnId, callId }, { type: "turnFinished", turnId, outcome: "completed" }]);
  expect(agentConversationRequiresToolRecovery(confirmed)).toBe(false);
  const legacy = project([...prefix.slice(0, 2), ...result, { type: "turnFinished", turnId, outcome: "completed" }]);
  expect(agentConversationRequiresToolRecovery(legacy)).toBe(false);
});
it("preserves a child creation intent only for its accepted provider call", () => {
  const call: AgentEventPayload = { type: "itemAccepted", turnId, itemId: callItem,
    kind: { type: "toolCall", callId, name: "research_spawn_subtask", providerCallId: "provider-call" }, text: "{}", phase: null, source: null };
  const prepared: AgentEventPayload = { type: "childCreationPrepared", turnId, callId, version: 1, childId: resultItem,
    operationId: conversationId, binding: { kind: "paper", resourceId: " paper " } };
  const start = prefix[0]!;
  expect(() => project([start, prepared])).toThrow();
  expect(() => decodeAgentEvent({ schemaVersion: 1, conversationId, seq: 3, timestampMs: 1, requestId: turnId,
    payload: { ...prepared, version: 2 } })).toThrow();
  const state = project([start, call, prepared]);
  expect(state.turns.get(turnId)?.childCreationIntents?.get(callId)).toEqual({ childId: resultItem, operationId: conversationId, binding: { kind: "paper", resourceId: " paper " } });
  const preparedV2: AgentEventPayload = { ...prepared, version: 2, submissionRequestId: childCreationFixtureV2.payload.submissionRequestId };
  const stateV2 = project([start, call, preparedV2]);
  expect(stateV2.turns.get(turnId)?.childCreationIntents?.get(callId)?.submissionRequestId).toBe(childCreationFixtureV2.payload.submissionRequestId);
  expect(() => decodeAgentEvent({ schemaVersion: 1, conversationId, seq: 3, timestampMs: 1, requestId: turnId,
    payload: { ...prepared, submissionRequestId: turnId } })).toThrow();
  expect(() => project([start, call, prepared, prepared])).toThrow();
  const otherCall: AgentEventPayload = { ...call, itemId: resultItem, kind: { type: "toolCall", callId: resultItem, name: "research_spawn_subtask", providerCallId: "other" } };
  expect(() => project([start, call, prepared, otherCall, { ...prepared, callId: resultItem }])).toThrow();
});
