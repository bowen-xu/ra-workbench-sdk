import { expect, it } from "vitest";
import { decodeAgentEvent, type AgentEventPayload } from "./events";
import { applyAgentEvents, createAgentConversationProjection } from "./projection";

const conversationId = "11111111-1111-4111-8111-111111111111";
const turnId = "22222222-2222-4222-8222-222222222222";
const attemptId = "33333333-3333-4333-8333-333333333333";
const reasoningId = "44444444-4444-4444-8444-444444444444";
const messageId = "55555555-5555-4555-8555-555555555555";
const model = { providerId: "fixture", modelId: "fixture", revision: null };
const material = { schema_version: 1, api: "responses", model, item_type: "reasoning",
  item_id: "rs-fixture", data: { item: { type: "reasoning", encrypted_content: "opaque-fixture" } },
  future_provider_field: { preserved: true } };
const source = { attemptId, ordinal: 0, providerItemId: "rs-fixture", providerDataJson: JSON.stringify(material) };
const native: AgentEventPayload = { type: "itemAccepted", turnId, itemId: reasoningId,
  kind: { type: "providerNative", itemType: "reasoning" }, text: "", phase: null, source };
function event(payload: AgentEventPayload, seq = 1) {
  return decodeAgentEvent({ schemaVersion: 1, conversationId, requestId: attemptId, seq, timestampMs: 1, payload });
}
function project(payloads: AgentEventPayload[]) {
  return applyAgentEvents(createAgentConversationProjection(conversationId), payloads.map((payload, i) => event(payload, i + 1)));
}
const start: AgentEventPayload[] = [
  { type: "turnStarted", turnId, contextSnapshotId: messageId, model },
  { type: "phaseChanged", turnId, phase: "runningModel" },
  { type: "modelRequestStarted", turnId, attemptId, model },
  { type: "modelResponseStarted", turnId, attemptId, responseId: "response", model: null },
];

it("retains native-only material and its admission position after a later failed sample", () => {
  const result = project([...start, native,
    { type: "itemAccepted", turnId, itemId: messageId, kind: { type: "assistantMessage" }, text: "answer", phase: "finalAnswer",
      source: { attemptId, ordinal: 1, providerItemId: "message", providerDataJson: null } },
    { type: "modelRequestFailed", turnId, attemptId, error: "offline", retryable: true, category: null },
  ]);
  const turn = result.turns.get(turnId)!;
  expect(turn.itemOrder).toEqual([reasoningId, messageId]);
  expect(turn.items.get(reasoningId)).toMatchObject({ kind: { type: "providerNative", itemType: "reasoning" },
    text: "", completed: true, interrupted: false, source });
  expect(turn.items.get(reasoningId)?.phase).toBeUndefined();
  expect(JSON.parse(turn.items.get(reasoningId)!.source!.providerDataJson!)).toEqual(material);
});

it("rejects fake assistant/tool envelopes, draft native items, missing material and unknown envelope versions", () => {
  if (native.type !== "itemAccepted") throw new Error("fixture");
  for (const payload of [
    { ...native, text: "not a native-only body" }, { ...native, source: null },
    { ...native, phase: "reasoning" },
    { ...native, kind: { type: "providerNative", itemType: "function_call" } },
    { ...native, source: { ...source, providerDataJson: JSON.stringify({ ...material, schema_version: 2 }) } },
    { type: "itemStarted", turnId, itemId: reasoningId, kind: native.kind },
  ]) expect(() => decodeAgentEvent({ ...event(native), payload })).toThrow();
});

it("does not let a native item skip the done ordinal", () => {
  if (native.type !== "itemAccepted") throw new Error("fixture");
  expect(() => project([...start, { ...native, source: { ...source, ordinal: 1 } }])).toThrow();
});
