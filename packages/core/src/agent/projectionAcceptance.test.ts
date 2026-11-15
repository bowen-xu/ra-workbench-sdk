import { expect, it } from "vitest";
import { decodeAgentEvent, type AgentEventPayload } from "./events";
import { applyAgentEvents, createAgentConversationProjection } from "./projection";

const conversationId = "11111111-1111-4111-8111-111111111111";
const turnId = "22222222-2222-4222-8222-222222222222";
const first = "33333333-3333-4333-8333-333333333333";
const second = "44444444-4444-4444-8444-444444444444";
const attemptId = "55555555-5555-4555-8555-555555555555";
const model = { providerId: "test", modelId: "test", revision: null };
function project(payloads: AgentEventPayload[]) {
  return applyAgentEvents(createAgentConversationProjection(conversationId), payloads.map((payload, i) => decodeAgentEvent({
    schemaVersion: 1, conversationId, seq: i + 1, timestampMs: 1, requestId: turnId, payload,
  })));
}
function start(): AgentEventPayload[] { return [
  { type: "turnStarted", turnId, contextSnapshotId: first, model },
  { type: "phaseChanged", turnId, phase: "runningModel" },
  { type: "modelRequestStarted", turnId, attemptId, model },
  { type: "modelResponseStarted", turnId, attemptId, responseId: "sparse", model: null },
]; }
function accepted(itemId: string, ordinal: number, text: string): AgentEventPayload {
  return { type: "itemAccepted", turnId, itemId, kind: { type: "assistantMessage" }, text, phase: "commentary",
    source: { attemptId, ordinal, providerItemId: `native-${ordinal}`, providerDataJson: '{"version":1}' } };
}
it("binds the interleaving marker before the response and rejects duplicates", () => {
  const beforeResponse = start().slice(0, 3);
  const marker: AgentEventPayload = { type: "modelOutputInterleavingStarted", turnId, attemptId };
  expect(project([...beforeResponse, marker]).turns.get(turnId)?.attempts.get(attemptId)?.interleavedToolResults).toBe(true);
  expect(() => project([...beforeResponse, marker, marker])).toThrow();
  expect(() => project([...beforeResponse, { type: "itemStarted", turnId, itemId: first, kind: { type: "assistantMessage" } }, marker])).toThrow();
  expect(() => project([...start(), marker])).toThrow();
  expect(project(start()).turns.get(turnId)?.attempts.get(attemptId)?.interleavedToolResults).toBeUndefined();
});
it.each([false, true])("orders a live draft using only the explicitly marked mode: %s", interleaved => {
  const resultId = "66666666-6666-4666-8666-666666666666";
  const marker: AgentEventPayload[] = interleaved ? [{ type: "modelOutputInterleavingStarted", turnId, attemptId }] : [];
  const events: AgentEventPayload[] = [...start().slice(0, 3), ...marker, ...start().slice(3),
    { type: "itemAccepted", turnId, itemId: first, kind: { type: "toolCall", callId: second, providerCallId: "wire-call", name: "read" }, text: "{}", phase: null,
      source: { attemptId, ordinal: 0, providerItemId: "fc", providerDataJson: null } },
    { type: "itemStarted", turnId, itemId: resultId, kind: { type: "toolResult", callId: second, isError: false } },
    { type: "itemCompleted", turnId, itemId: resultId },
    { type: "itemStarted", turnId, itemId: second, kind: { type: "assistantMessage" } },
  ];
  const expected = interleaved ? [first, second, resultId] : [first, resultId, second];
  expect(project(events).turns.get(turnId)?.itemOrder).toEqual(expected);
  expect(project([...events, accepted(second, 1, "later")]).turns.get(turnId)?.itemOrder).toEqual(expected);
});
it("never moves a new attempt ahead of the previous attempt's result", () => {
  const resultId = "66666666-6666-4666-8666-666666666666";
  const nextAttempt = "77777777-7777-4777-8777-777777777777";
  const turn = project([...start().slice(0, 3), { type: "modelOutputInterleavingStarted", turnId, attemptId }, ...start().slice(3),
    { type: "itemAccepted", turnId, itemId: first, kind: { type: "toolCall", callId: second, name: "read" }, text: "{}", phase: null,
      source: { attemptId, ordinal: 0, providerItemId: "fc", providerDataJson: null } },
    { type: "itemStarted", turnId, itemId: resultId, kind: { type: "toolResult", callId: second, isError: false } },
    { type: "itemCompleted", turnId, itemId: resultId },
    { type: "modelRequestFinished", turnId, attemptId, inputTokens: null, outputTokens: null },
    { type: "modelRequestStarted", turnId, attemptId: nextAttempt, model },
    { type: "modelOutputInterleavingStarted", turnId, attemptId: nextAttempt },
    { type: "modelResponseStarted", turnId, attemptId: nextAttempt, responseId: "next", model: null },
    { type: "itemStarted", turnId, itemId: second, kind: { type: "assistantMessage" } },
  ]).turns.get(turnId)!;
  expect(turn.itemOrder).toEqual([first, resultId, second]);
});
it("atomically accepts a draft with metadata and freezes done admission order across a later failure", () => {
  const projection = project([...start(),
    { type: "itemStarted", turnId, itemId: first, kind: { type: "assistantMessage" } },
    { type: "textDelta", turnId, itemId: first, text: "A" },
    accepted(second, 0, "B"), accepted(first, 1, "A"),
    { type: "modelRequestFailed", turnId, attemptId, error: "connection failed", retryable: true, category: null },
  ]);
  const turn = projection.turns.get(turnId)!;
  expect(turn.itemOrder).toEqual([second, first]);
  expect(turn.items.get(first)).toMatchObject({ text: "A", completed: true, interrupted: false, nativePhase: "commentary", source: { ordinal: 1 } });
  expect(turn.attempts.get(attemptId)?.actualModel).toBeNull();
  expect(() => project([...start(), accepted(first, 0, "A"), accepted(second, 1, "B"),
    { type: "modelOutputOrder", turnId, itemIds: [second, first] }])).toThrow();
});
it("rejects legacy acceptance with a different draft body and canonical ordinal gaps", () => {
  const draft: AgentEventPayload[] = [...start(), { type: "itemStarted", turnId, itemId: first, kind: { type: "assistantMessage" } }, { type: "textDelta", turnId, itemId: first, text: "draft" }];
  expect(() => project([...draft, { type: "itemAccepted", turnId, itemId: first, kind: { type: "assistantMessage" }, text: "other", phase: null, source: null }])).toThrow();
  expect(() => project([...draft, accepted(second, 1, "gap")])).toThrow();
});
it("records a model only after explicit provider observation", () => {
  const updated = { ...model, modelId: "server-updated" };
  const turn = project([...start(), { type: "modelIdentityObserved", turnId, attemptId, model },
    { type: "modelIdentityObserved", turnId, attemptId, model: updated }]).turns.get(turnId)!;
  expect(turn.attempts.get(attemptId)?.actualModel).toEqual(updated);
});

it("retains an unknown external effect barrier across a later turn", () => {
  const payloads: AgentEventPayload[] = [...start(),
    { type: "itemAccepted", turnId, itemId: first, kind: { type: "toolCall", callId: second, name: "external_write" }, text: "{}", phase: null, source: null },
    { type: "turnFailed", turnId, error: "tool execution outcome unknown", category: "recovery" },
    { type: "turnFinished", turnId, outcome: "failed" },
  ];
  expect(project(payloads).turns.get(turnId)?.items.get(first)?.completed).toBe(true);
  expect(() => project([...payloads, { type: "turnStarted", turnId: second, contextSnapshotId: first, model }])).toThrow();
});

it("blocks a new turn after an accepted call is interrupted before any failure diagnostic", () => {
  const payloads: AgentEventPayload[] = [...start(),
    { type: "itemAccepted", turnId, itemId: first, kind: { type: "toolCall", callId: second, name: "external_write" }, text: "{}", phase: null, source: null },
    { type: "turnFinished", turnId, outcome: "interrupted" },
  ];
  expect(() => project([...payloads, { type: "turnStarted", turnId: second, contextSnapshotId: first, model }])).toThrow();
});

it.each(["", "{", "[1]", "null", "7", '"text"'])("keeps raw tool intent %j paired with parameter feedback", text => {
  const resultId = "66666666-6666-4666-8666-666666666666";
  const payloads: AgentEventPayload[] = [...start(),
    { type: "itemAccepted", turnId, itemId: first,
      kind: { type: "toolCall", callId: second, providerCallId: "wire-call", name: "read" }, text, phase: null,
      source: { attemptId, ordinal: 0, providerItemId: "fc", providerDataJson: null } },
    { type: "itemStarted", turnId, itemId: resultId, kind: { type: "toolResult", callId: second, isError: true } },
    { type: "textDelta", turnId, itemId: resultId, text: '{"code":"invalid_tool_arguments"}' },
    { type: "itemCompleted", turnId, itemId: resultId },
    { type: "modelRequestFinished", turnId, attemptId, inputTokens: null, outputTokens: null },
    { type: "turnFinished", turnId, outcome: "interrupted" },
    { type: "turnStarted", turnId: second, contextSnapshotId: first, model },
  ];
  const projection = project(payloads);
  expect(projection.turns.get(turnId)?.items.get(first)).toMatchObject({ text, accepted: true, completed: true });
  expect(projection.turns.get(turnId)?.items.get(resultId)?.kind).toEqual({ type: "toolResult", callId: second, isError: true });
  expect(projection.turns.has(second)).toBe(true);
});
