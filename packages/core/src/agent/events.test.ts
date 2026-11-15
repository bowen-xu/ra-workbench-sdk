import { describe, expect, it } from "vitest";

import { AgentEventDecodeError, decodeAgentEvent } from "./events";
import { applyAgentEvents, createAgentConversationProjection } from "./projection";

const event = (error: unknown, retryable: unknown, category: unknown = "provider") => ({
  schemaVersion: 1,
  conversationId: "11111111-1111-4111-8111-111111111111",
  seq: 1,
  timestampMs: 1,
  requestId: "22222222-2222-4222-8222-222222222222",
  payload: {
    type: "modelRequestFailed",
    turnId: "33333333-3333-4333-8333-333333333333",
    attemptId: "44444444-4444-4444-8444-444444444444",
    error,
    retryable,
    category,
  },
});

describe("agent event decoder", () => {
  it("preserves native phase provenance and rejects invalid provenance", () => {
    const input = { ...event("unused", false), payload: {
      type: "itemPhaseChanged", turnId: "33333333-3333-4333-8333-333333333333",
      itemId: "55555555-5555-4555-8555-555555555555", phase: "commentary", native: true,
    } };
    expect(decodeAgentEvent(input).payload).toMatchObject({ phase: "commentary", native: true });
    expect(() => decodeAgentEvent({ ...input, payload: { ...input.payload, native: "true" } })).toThrow(AgentEventDecodeError);
    expect(() => decodeAgentEvent({ ...input, payload: { ...input.payload, phase: "reasoning" } })).toThrow(AgentEventDecodeError);
  });
  it("decodes item-level assistant phases without merging item identities", () => {
    const decoded = decodeAgentEvent({
      schemaVersion: 1,
      conversationId: "11111111-1111-4111-8111-111111111111",
      seq: 2,
      timestampMs: 2,
      requestId: "22222222-2222-4222-8222-222222222222",
      payload: {
        type: "itemPhaseChanged",
        turnId: "33333333-3333-4333-8333-333333333333",
        itemId: "55555555-5555-4555-8555-555555555555",
        phase: "finalAnswer",
      },
    });
    expect(decoded.payload).toEqual({
      type: "itemPhaseChanged",
      turnId: "33333333-3333-4333-8333-333333333333",
      itemId: "55555555-5555-4555-8555-555555555555",
      phase: "finalAnswer",
    });
  });

  it("accepts bounded model request failure diagnostics", () => {
    expect(decodeAgentEvent(event("request preparation failed", false)).payload).toEqual({
      type: "modelRequestFailed",
      turnId: "33333333-3333-4333-8333-333333333333",
      attemptId: "44444444-4444-4444-8444-444444444444",
      error: "request preparation failed",
      retryable: false,
      category: "provider",
    });
  });

  it("keeps legacy failures without a category readable", () => {
    const legacy = event("request preparation failed", false) as { payload: Record<string, unknown> };
    delete legacy.payload.category;
    expect(decodeAgentEvent(legacy).payload).toMatchObject({ category: null });
  });

  it("rejects unknown failure categories", () => {
    expect(() => decodeAgentEvent(event("request preparation failed", false, "network"))).toThrow(AgentEventDecodeError);
  });

  it.each([
    ["", false],
    ["x".repeat(1_025), false],
    ["request preparation failed", "false"],
  ])("rejects invalid model request failure diagnostics", (error, retryable) => {
    expect(() => decodeAgentEvent(event(error, retryable))).toThrow(AgentEventDecodeError);
  });
});

it("keeps legacy task events compatible and validates compact task identity", () => {
  const base = event("unused", false);
  const payload = { type: "turnStarted", turnId: base.payload.turnId,
    contextSnapshotId: base.requestId, model: { providerId: "test", modelId: "test", revision: null } };
  expect(decodeAgentEvent({ ...base, payload }).payload).toEqual(payload);
  expect(decodeAgentEvent({ ...base, payload: { ...payload, taskKind: "compact" } }).payload)
    .toEqual({ ...payload, taskKind: "compact" });
  for (const [wire, expected] of [[payload, "regular"], [{ ...payload, taskKind: "compact" }, "compact"]] as const) {
    const decoded = decodeAgentEvent({ ...base, payload: wire });
    const projection = applyAgentEvents(createAgentConversationProjection(base.conversationId), [decoded]);
    expect(projection.turns.get(payload.turnId)?.taskKind).toBe(expected);
  }
  for (const taskKind of [null, "unknown", 1]) {
    expect(() => decodeAgentEvent({ ...base, payload: { ...payload, taskKind } })).toThrow(AgentEventDecodeError);
  }
});

it("projects context compaction without a model attempt or text and interrupts unfinished items", () => {
  const base = event("unused", false);
  const turnId = base.payload.turnId;
  const itemId = "55555555-5555-4555-8555-555555555555";
  const wire = (seq: number, payload: unknown) => decodeAgentEvent({ ...base, seq, payload });
  const started = wire(1, { type: "turnStarted", turnId, contextSnapshotId: base.requestId,
    model: { providerId: "test", modelId: "test", revision: null }, taskKind: "compact" });
  const itemStarted = wire(2, { type: "itemStarted", turnId, itemId, kind: { type: "contextCompaction" } });
  const open = applyAgentEvents(createAgentConversationProjection(base.conversationId), [started, itemStarted]);
  expect(open.turns.get(turnId)?.attempts.size).toBe(0);
  expect(() => applyAgentEvents(open, [wire(3, { type: "textDelta", turnId, itemId, text: "summary" })])).toThrow();
  expect(() => applyAgentEvents(open, [wire(3, { type: "turnFinished", turnId, outcome: "completed" })])).toThrow();
  const completed = applyAgentEvents(open, [wire(3, { type: "itemCompleted", turnId, itemId }),
    wire(4, { type: "turnFinished", turnId, outcome: "completed" })]);
  expect(completed.turns.get(turnId)?.items.get(itemId)).toMatchObject({ completed: true, text: "" });
  expect(completed.turns.get(turnId)?.inputTokens).toBeNull();
  const canceled = applyAgentEvents(open, [wire(3, { type: "turnFinished", turnId, outcome: "canceled" })]);
  expect(canceled.turns.get(turnId)?.items.get(itemId)).toMatchObject({ completed: false, interrupted: true });
  expect(() => wire(2, { type: "itemStarted", turnId, itemId, kind: { type: "contextCompaction", value: "summary" } })).toThrow();
});
