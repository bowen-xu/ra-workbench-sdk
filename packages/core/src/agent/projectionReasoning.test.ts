import { expect, it } from "vitest";
import { decodeAgentEvent, type AgentEventPayload } from "./events";
import { applyAgentEvents, createAgentConversationProjection } from "./projection";

const conversationId = "11111111-1111-4111-8111-111111111111", turnId = "22222222-2222-4222-8222-222222222222";
const itemId = "33333333-3333-4333-8333-333333333333", attemptId = "44444444-4444-4444-8444-444444444444";
const nextAttempt = "55555555-5555-4555-8555-555555555555", nextItem = "66666666-6666-4666-8666-666666666666";
const model = { providerId: "fixture", modelId: "fixture", revision: null };
const start = (): AgentEventPayload[] => [
  { type: "turnStarted", turnId, contextSnapshotId: itemId, model }, { type: "phaseChanged", turnId, phase: "runningModel" },
  { type: "modelRequestStarted", turnId, attemptId, model }, { type: "modelResponseStarted", turnId, attemptId, responseId: "first", model: null },
  { type: "itemStarted", turnId, itemId, kind: { type: "reasoningSummary", parts: [] } },
];
const delta = (summaryIndex: string, text: string): AgentEventPayload => ({ type: "reasoningSummaryDelta", turnId, itemId, summaryIndex, text });
const accepted = (text: string): AgentEventPayload => ({ type: "itemAccepted", turnId, itemId, kind: { type: "reasoningSummary", parts: [{ index: "0", startByte: 0, lenByte: text.length }] }, text, phase: null,
  source: { attemptId, ordinal: 0, providerItemId: "reasoning", providerDataJson: null } });
function project(payloads: readonly AgentEventPayload[]) {
  return applyAgentEvents(createAgentConversationProjection(conversationId), payloads.map((payload, i) => decodeAgentEvent({ schemaVersion: 1, conversationId, requestId: turnId, timestampMs: 1, seq: i + 1, payload })));
}

it("accumulates interleaved arbitrary i64 part identities in first-seen order", () => {
  const state = project([...start(), { type: "reasoningSummaryPartAdded", turnId, itemId, summaryIndex: "9223372036854775807" },
    delta("9223372036854775807", "A1"), delta("-9223372036854775808", "B1"), delta("9223372036854775807", "A2"),
    { type: "reasoningSummaryPartAdded", turnId, itemId, summaryIndex: "9223372036854775807" }]);
  const item = state.turns.get(turnId)!.items.get(itemId)!;
  expect([...item.reasoningSummaryDraft!]).toEqual([["9223372036854775807", "A1A2"], ["-9223372036854775808", "B1"]]);
  expect(item.text).toBe("A1A2B1"); expect(item.kind).toEqual({ type: "reasoningSummary", parts: [] });
  expect(item.attemptId).toBe(attemptId);
});
it("replaces draft text and parts atomically from canonical completion without relaxing assistant acceptance", () => {
  const state = project([...start(), delta("-3", "draft"), accepted("canonical")]);
  expect(state.turns.get(turnId)!.items.get(itemId)).toMatchObject({ text: "canonical", completed: true, accepted: true, kind: { parts: [{ index: "0", startByte: 0, lenByte: 9 }] } });
  expect(state.turns.get(turnId)!.items.get(itemId)?.reasoningSummaryDraft).toBeUndefined();
  const assistant: AgentEventPayload[] = start().map(p => p.type === "itemStarted" ? { ...p, kind: { type: "assistantMessage" } } : p);
  expect(() => project([...assistant, { type: "textDelta", turnId, itemId, text: "draft" },
    { type: "itemAccepted", turnId, itemId, kind: { type: "assistantMessage" }, text: "canonical", phase: null, source: null }])).toThrow();
});
it("accepts a sparse canonical summary without prior draft events", () => {
  const state = project([...start().slice(0, -1), accepted("canonical")]);
  expect(state.turns.get(turnId)!.items.get(itemId)).toMatchObject({ text: "canonical", completed: true, attemptId });
});
it("clears visible progress when the canonical public summary is empty", () => {
  const done = accepted("");
  if (done.type !== "itemAccepted") throw new Error("Expected completion fixture");
  const state = project([...start(), delta("0", "draft must disappear"), { ...done, kind: { type: "reasoningSummary", parts: [] } }]);
  expect(state.turns.get(turnId)!.items.get(itemId)).toMatchObject({ text: "", completed: true, kind: { type: "reasoningSummary", parts: [] } });
  expect(state.turns.get(turnId)!.items.get(itemId)?.reasoningSummaryDraft).toBeUndefined();
});
it("keeps completed summaries and interrupts only unfinished attempt parts across retry and cancellation", () => {
  const state = project([...start(), delta("0", "incomplete"),
    { type: "modelRequestFailed", turnId, attemptId, error: "offline", retryable: true, category: null },
    { type: "modelRequestStarted", turnId, attemptId: nextAttempt, model },
    { type: "modelResponseStarted", turnId, attemptId: nextAttempt, responseId: "second", model: null },
    { type: "itemAccepted", turnId, itemId: nextItem, kind: { type: "reasoningSummary", parts: [{ index: "0", startByte: 0, lenByte: 4 }] }, text: "done", phase: null,
      source: { attemptId: nextAttempt, ordinal: 0, providerItemId: "next", providerDataJson: null } },
    { type: "modelRequestFinished", turnId, attemptId: nextAttempt, inputTokens: null, outputTokens: null }, { type: "turnFinished", turnId, outcome: "completed" }]);
  expect(state.turns.get(turnId)!.items.get(itemId)).toMatchObject({ interrupted: true, completed: false, text: "incomplete" });
  expect(state.turns.get(turnId)!.items.get(nextItem)).toMatchObject({ interrupted: false, completed: true, text: "done" });
  const canceled = project([...start(), delta("0", "partial"), { type: "turnFinished", turnId, outcome: "canceled" }]);
  expect(canceled.turns.get(turnId)!.items.get(itemId)).toMatchObject({ interrupted: true, completed: false, text: "partial" });
});
it("rejects generic body completion and late progress after an interrupted or accepted summary", () => {
  for (const event of [{ type: "textDelta", turnId, itemId, text: "wrong" }, { type: "itemCompleted", turnId, itemId }] as const) {
    expect(() => project([...start(), event])).toThrow();
  }
  expect(() => project([...start(), accepted("done"), delta("0", "late")])).toThrow();
  expect(() => project([...start(), { type: "modelRequestFailed", turnId, attemptId, error: "offline", retryable: true, category: null }, delta("0", "late")])).toThrow();
});
