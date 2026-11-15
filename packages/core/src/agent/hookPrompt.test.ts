import { expect, it } from "vitest";
import { decodeAgentEvent } from "./events";
import { applyAgentEvents, createAgentConversationProjection } from "./projection";
import { decodeAgentConversationExport } from "./conversationExport";

const conversationId = "11111111-1111-4111-8111-111111111111";
const turnId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";
const itemId = "44444444-4444-4444-8444-444444444444";
const invocationId = "55555555-5555-4555-8555-555555555555";
const runId = "66666666-6666-4666-8666-666666666666";
const kind = { type: "hookPrompt", invocationId, fragments: [{ runId, inputText: "<hook_prompt>retry</hook_prompt>" }] };
const event = (seq: number, payload: unknown) => decodeAgentEvent({ schemaVersion: 1, conversationId, seq, timestampMs: 1, requestId: turnId, payload });
const acceptance = { type: "itemAccepted", turnId, itemId, kind, text: "", phase: null, source: null };

it("projects an accepted hook prompt and rolls back its containing user turn", () => {
  const payloads = [
    { type: "turnStarted", turnId, contextSnapshotId: itemId, model: { providerId: "test", modelId: "test", revision: null } },
    { type: "itemStarted", turnId, itemId: userId, kind: { type: "userMessage" } },
    { type: "textDelta", turnId, itemId: userId, text: "question" },
    { type: "itemCompleted", turnId, itemId: userId }, acceptance,
    { type: "turnFinished", turnId, outcome: "completed" },
  ];
  const state = applyAgentEvents(createAgentConversationProjection(conversationId), payloads.map((p, i) => event(i + 1, p)));
  expect(state.turns.get(turnId)?.items.get(itemId)).toMatchObject({ kind, completed: true });
  const nextTurn = "77777777-7777-4777-8777-777777777777";
  const nextItem = "88888888-8888-4888-8888-888888888888";
  const withHookOnlyTurn = applyAgentEvents(state, [
    event(7, { type: "turnStarted", turnId: nextTurn, contextSnapshotId: nextItem, model: { providerId: "test", modelId: "test", revision: null } }),
    event(8, { ...acceptance, turnId: nextTurn, itemId: nextItem }),
    event(9, { type: "turnFinished", turnId: nextTurn, outcome: "completed" }),
  ]);
  const rolledBack = applyAgentEvents(withHookOnlyTurn, [event(10, { type: "conversationRolledBack", turnId: nextTurn, userTurns: 1 })]);
  expect(rolledBack.turnOrder).toEqual([]);
});

it("rejects incomplete, duplicate or non-atomic hook prompts", () => {
  for (const patch of [
    { kind: { ...kind, fragments: [] } },
    { kind: { ...kind, fragments: [kind.fragments[0], kind.fragments[0]] } },
    { kind: { ...kind, fragments: [{ runId, inputText: "\ud800" }] } },
    { text: "unexpected" },
    { source: { attemptId: turnId, ordinal: 0, providerItemId: null, providerDataJson: null } },
  ]) expect(() => event(2, { ...acceptance, ...patch })).toThrow();
  expect(() => event(2, { type: "itemStarted", turnId, itemId, kind })).toThrow();
});

it("keeps hook source and ordered fragments in portable export", () => {
  const exported = decodeAgentConversationExport({ format: "research-assistant.conversation", schemaVersion: 1, watermark: 1,
    conversation: { id: conversationId, title: "Fixture", archived: false, createdAt: "2026-10-26T00:00:00.000Z", updatedAt: "2026-10-26T00:00:00.000Z" },
    turns: [{ id: turnId, contextSnapshotId: itemId, model: { providerId: "test", modelId: "test", revision: null }, phase: "runningModel", outcome: null,
      inputTokens: null, outputTokens: null, attempts: [], items: [{ id: itemId, kind, text: "", completed: true, interrupted: false }] }],
  });
  expect(exported.turns[0]?.items[0]?.kind).toEqual(kind);
});
