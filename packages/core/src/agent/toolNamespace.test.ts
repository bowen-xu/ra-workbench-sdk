import { expect, it } from "vitest";
import { decodeAgentEvent, type AgentEvent } from "./events";
import { decodeAgentHistoryResponse } from "./session";
import { applyAgentEvents, createAgentConversationProjection } from "./projection";
import { decodeAgentConversationExport, type AgentExportItemKind } from "./conversationExport";

const conversationId = "11111111-1111-4111-8111-111111111111";
const turnId = "22222222-2222-4222-8222-222222222222";
const itemId = "33333333-3333-4333-8333-333333333333";
const callId = "44444444-4444-4444-8444-444444444444";
const model = { providerId: "openai", modelId: "gpt-5.6-terra", revision: "synthetic-wire-v1" };
function tool(namespace: unknown, present = true) {
  return { type: "toolCall", callId, name: "research_list_sources", ...(present ? { namespace } : {}) };
}
function accepted(namespace: unknown, present = true): AgentEvent {
  return decodeAgentEvent({ schemaVersion: 1, conversationId, seq: 1, timestampMs: 1, requestId: turnId,
    payload: { type: "itemAccepted", turnId, itemId, kind: tool(namespace, present), text: "{}", phase: null, source: null } });
}
function exportKind(kind: unknown): AgentExportItemKind {
  const exported = decodeAgentConversationExport({ format: "research-assistant.conversation", schemaVersion: 1, watermark: 1,
    conversation: { id: conversationId, title: "Synthetic", archived: false, createdAt: "2026-10-26T00:00:00.000Z", updatedAt: "2026-10-26T00:00:00.000Z" },
    turns: [{ id: turnId, contextSnapshotId: itemId, model, phase: "runningTools", outcome: null,
      inputTokens: null, outputTokens: null, attempts: [], items: [{ id: itemId, kind, text: "{}", completed: true, interrupted: false }] }],
  });
  return exported.turns[0]!.items[0]!.kind;
}

it.each(["", "foreign::", "命名空间".repeat(100)])("preserves namespace %j through events, history and portable export", namespace => {
  const event = accepted(namespace);
  expect(event.payload).toMatchObject({ kind: tool(namespace) });
  const history = decodeAgentHistoryResponse({ schemaVersion: 1, conversationId, afterSeq: 0, watermark: 1, nextAfterSeq: null, events: [event] });
  expect(history.events[0]?.payload).toEqual(event.payload);
  expect(exportKind(tool(namespace))).toEqual(tool(namespace));
});

it("normalizes missing and null namespace to the legacy absent field without changing old serialized facts", () => {
  const missing = accepted(undefined, false), nullable = accepted(null);
  expect(JSON.stringify(nullable)).toBe(JSON.stringify(missing));
  expect(missing.payload).toMatchObject({ kind: { type: "toolCall", callId, name: "research_list_sources" } });
  const original = tool(undefined, false);
  expect(JSON.stringify(exportKind(tool(null)))).toBe(JSON.stringify(original));
});

it.each([42, true, {}, []])("rejects a non-string namespace %j at both decoding boundaries", namespace => {
  expect(() => accepted(namespace)).toThrow();
  expect(() => exportKind(tool(namespace))).toThrow();
});

it("preserves empty namespace as distinct from flat identity when reconciling a draft", () => {
  const start = decodeAgentEvent({ schemaVersion: 1, conversationId, seq: 1, timestampMs: 1, requestId: turnId,
    payload: { type: "turnStarted", turnId, contextSnapshotId: itemId, model } });
  const draft = decodeAgentEvent({ ...start, seq: 2, payload: { type: "itemStarted", turnId, itemId, kind: tool("") } });
  const text = decodeAgentEvent({ ...start, seq: 3, payload: { type: "textDelta", turnId, itemId, text: "{}" } });
  const base = applyAgentEvents(createAgentConversationProjection(conversationId), [start, draft, text]);
  const complete = { ...accepted(""), seq: 4 };
  expect(applyAgentEvents(base, [complete]).turns.get(turnId)?.items.get(itemId)?.kind).toEqual(tool(""));
  expect(() => applyAgentEvents(base, [{ ...accepted(undefined, false), seq: 4 }])).toThrow();
  expect(() => applyAgentEvents(base, [{ ...accepted("foreign::"), seq: 4 }])).toThrow();
});
