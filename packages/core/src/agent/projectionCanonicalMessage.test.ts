import { expect, it } from "vitest";
import { decodeAgentEvent, type AgentEventPayload } from "./events";
import { applyAgentEvents, createAgentConversationProjection, type AgentConversationProjection } from "./projection";

const conversationId = "11111111-1111-4111-8111-111111111111";
const turnId = "22222222-2222-4222-8222-222222222222";
const itemId = "33333333-3333-4333-8333-333333333333";
const attemptId = "44444444-4444-4444-8444-444444444444";
const nextAttempt = "55555555-5555-4555-8555-555555555555";
const model = { providerId: "fixture", modelId: "fixture", revision: null };
type Acceptance = Extract<AgentEventPayload, { type: "itemAccepted" }>;

function draft(): AgentEventPayload[] {
  return [
    { type: "turnStarted", turnId, contextSnapshotId: itemId, model },
    { type: "phaseChanged", turnId, phase: "runningModel" },
    { type: "modelRequestStarted", turnId, attemptId, model },
    { type: "modelResponseStarted", turnId, attemptId, responseId: "first", model: null },
    { type: "itemStarted", turnId, itemId, kind: { type: "assistantMessage" } },
    { type: "itemPhaseChanged", turnId, itemId, phase: "commentary", native: true },
    { type: "textDelta", turnId, itemId, text: "draft" },
  ];
}
function done(overrides: Partial<Acceptance> = {}): Acceptance {
  return { type: "itemAccepted", turnId, itemId, kind: { type: "assistantMessage" }, text: "corrected", phase: "finalAnswer",
    source: { attemptId, ordinal: 0, providerItemId: "message", providerDataJson: null }, ...overrides };
}
function append(state: AgentConversationProjection, payloads: readonly AgentEventPayload[]) {
  return applyAgentEvents(state, payloads.map((payload, index) => decodeAgentEvent({
    schemaVersion: 1, conversationId, seq: state.seq + index + 1, timestampMs: 1, requestId: turnId, payload,
  })));
}
function project(payloads: readonly AgentEventPayload[]) {
  return append(createAgentConversationProjection(conversationId), payloads);
}
function item(state: AgentConversationProjection) {
  const projected = state.turns.get(turnId)?.items.get(itemId);
  if (!projected) throw new Error("Missing canonical message fixture");
  return projected;
}

it("atomically corrects a message's own draft and replays without changing the recorded draft", () => {
  const original = draft();
  const originalJson = JSON.stringify(original);
  const before = project(original);
  const accepted = done();
  const after = append(before, [accepted]);
  expect(item(before)).toMatchObject({ text: "draft", nativePhase: "commentary", completed: false, attemptId });
  expect(item(after)).toMatchObject({ text: "corrected", nativePhase: "finalAnswer", phase: "finalAnswer", completed: true, accepted: true,
    attemptId, source: { attemptId, ordinal: 0, providerItemId: "message" } });
  expect(after.turns.get(turnId)?.itemOrder).toEqual([itemId]);
  expect(project([...original, accepted])).toEqual(after);
  expect(JSON.stringify(original)).toBe(originalJson);
});

it("retains a draft's known phase when canonical completion omits phase", () => {
  const after = project([...draft(), done({ phase: null })]);
  expect(item(after)).toMatchObject({ text: "corrected", phase: "commentary", nativePhase: "commentary", completed: true });
});

it("rejects an ordinal gap without partially changing the draft or its order", () => {
  const before = project(draft());
  const expected = project(draft());
  const bad = done({ source: { attemptId, ordinal: 1, providerItemId: "message", providerDataJson: null } });
  expect(() => append(before, [bad])).toThrow();
  expect(before).toEqual(expected);
  expect(item(before)).toMatchObject({ text: "draft", nativePhase: "commentary", completed: false });
});

it.each(["corrected", "draft"])("rejects a new attempt taking an old unfinished draft with body %s", text => {
  const before = project([...draft(),
    { type: "modelRequestFinished", turnId, attemptId, inputTokens: null, outputTokens: null },
    { type: "modelRequestStarted", turnId, attemptId: nextAttempt, model },
    { type: "modelResponseStarted", turnId, attemptId: nextAttempt, responseId: "second", model: null },
  ]);
  expect(item(before)).toMatchObject({ text: "draft", completed: false, interrupted: false, attemptId });
  expect(() => append(before, [done({ text, source: { attemptId: nextAttempt, ordinal: 0, providerItemId: "message", providerDataJson: null } })])).toThrow();
});

it("rejects replacing an interrupted draft from a failed attempt", () => {
  const before = project([...draft(),
    { type: "modelRequestFailed", turnId, attemptId, error: "offline", retryable: true, category: null },
    { type: "modelRequestStarted", turnId, attemptId: nextAttempt, model },
    { type: "modelResponseStarted", turnId, attemptId: nextAttempt, responseId: "second", model: null },
  ]);
  expect(item(before)).toMatchObject({ text: "draft", completed: false, interrupted: true, attemptId });
  expect(() => append(before, [done({ source: { attemptId: nextAttempt, ordinal: 0, providerItemId: "message", providerDataJson: null } })])).toThrow();
});

it.each([
  { text: "corrected", phase: "commentary" as const },
  { text: "draft", phase: "finalAnswer" as const },
])("keeps legacy source-null body and phase checks: %j", ({ text, phase }) => {
  expect(() => project([...draft(), done({ text, phase, source: null })])).toThrow();
});

it("does not reopen a canonical item or change its kind", () => {
  const before = project(draft());
  const completed = append(before, [done()]);
  expect(() => append(completed, [done()])).toThrow();
  expect(() => append(completed, [{ type: "textDelta", turnId, itemId, text: "late" }])).toThrow();
  expect(() => append(before, [done({ kind: { type: "toolCall", callId: nextAttempt, name: "read" }, text: "{}", phase: null })])).toThrow();
});
