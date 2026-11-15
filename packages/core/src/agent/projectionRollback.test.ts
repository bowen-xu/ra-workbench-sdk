import { describe, expect, it } from "vitest";
import { decodeAgentEvent, type AgentEvent, type AgentEventPayload } from "./events";
import { AgentProjectionError, applyAgentEvents, createAgentConversationProjection, type AgentConversationProjection } from "./projection";
import rustRollbackFacts from "../../../../tests/fixtures/agent-rollback-events-v1.json";

const uuid = (value: number): string => `00000000-0000-0000-0000-${value.toString(16).padStart(12, "0")}`;
const conversationId = uuid(1), requestId = uuid(4);
const model = { providerId: "fixture", modelId: "model", revision: null };

function event(state: AgentConversationProjection, payload: AgentEventPayload): AgentEvent {
  return decodeAgentEvent({ schemaVersion: 1, conversationId, requestId, seq: state.seq + 1, timestampMs: 1, payload });
}
function history() {
  let state = createAgentConversationProjection(conversationId);
  const facts: AgentEvent[] = [];
  const emit = (payload: AgentEventPayload): void => {
    const next = event(state, payload);
    state = applyAgentEvents(state, [next]); facts.push(next);
  };
  return { get state() { return state; }, facts, emit,
    turn(id: number, users: number, taskKind: "regular" | "compact" = users ? "regular" : "compact") {
      const turnId = uuid(id);
      emit({ type: "turnStarted", turnId, contextSnapshotId: uuid(id + 100), model, taskKind });
      for (let index = 0; index < users; index += 1) {
        const itemId = uuid(id * 1000 + index);
        emit({ type: "itemStarted", turnId, itemId, kind: { type: "userMessage" } });
        emit({ type: "textDelta", turnId, itemId, text: "user" });
        emit({ type: "itemCompleted", turnId, itemId });
      }
      emit({ type: "turnFinished", turnId, outcome: "completed" });
    },
  };
}
function rejects(state: AgentConversationProjection, payload: AgentEventPayload): void {
  const original = snapshot(state);
  expect(() => applyAgentEvents(state, [event(state, payload)])).toThrow(AgentProjectionError);
  expect(snapshot(state)).toBe(original);
}
/** Preserve every nested Map/Set entry while staying independent of DOM APIs. */
function snapshot(state: AgentConversationProjection): string {
  return JSON.stringify(state, (_key, value: unknown) => value instanceof Map ? { entries: [...value] }
    : value instanceof Set ? { values: [...value] } : value);
}

describe("conversation rollback projection", () => {
  it("decodes and replays the actual Rust fixture intact across both rollback markers", () => {
    const facts = rustRollbackFacts.map(decodeAgentEvent);
    expect(facts).toEqual(rustRollbackFacts);
    const initial = createAgentConversationProjection(conversationId);
    const prefix = applyAgentEvents(initial, facts.slice(0, 17));
    expect(prefix.turnOrder).toEqual([uuid(10), uuid(20), uuid(30), uuid(40)]);
    const first = applyAgentEvents(prefix, facts.slice(17, 18));
    expect(first.seq).toBe(18);
    expect(first.turnOrder).toEqual([uuid(10), uuid(20)]);
    expect(first.turns.get(uuid(10))).toBe(prefix.turns.get(uuid(10)));
    expect(applyAgentEvents(first, facts.slice(17, 18))).toBe(first);
    const empty = applyAgentEvents(first, facts.slice(18, 19));
    expect(empty.seq).toBe(19);
    expect(empty.turnOrder).toEqual([]);
    const resumed = applyAgentEvents(empty, facts.slice(19));
    expect(resumed.seq).toBe(24);
    expect(resumed.turnOrder).toEqual([uuid(50)]);
    expect(applyAgentEvents(initial, facts)).toEqual(resumed);
    expect(prefix.turns.has(uuid(30))).toBe(true);
    expect(facts).toHaveLength(24);
    expect(resumed.rolledBackItemIds?.has(uuid(30_000))).toBe(true);
    expect(resumed.rolledBackItemIds?.has(uuid(30_001))).toBe(true);
  });

  it("counts user turns across compaction and steers, retaining facts and immutable earlier snapshots", () => {
    const log = history();
    log.turn(10, 1); log.turn(20, 0); log.turn(30, 2); log.turn(40, 0);
    const before = log.state, saved = snapshot(before), factCount = log.facts.length;
    const retained = before.turns.get(uuid(10));
    log.emit({ type: "conversationRolledBack", turnId: uuid(40), userTurns: 1 });
    expect(log.state.seq).toBe(before.seq + 1);
    expect(log.state.activeTurn).toBeNull();
    expect(log.state.turnOrder).toEqual([uuid(10), uuid(20)]);
    expect(log.state.turns.has(uuid(30))).toBe(false);
    expect(log.state.turns.has(uuid(40))).toBe(false);
    expect(log.state.turns.get(uuid(10))).toBe(retained);
    expect(snapshot(before)).toBe(saved);
    expect(log.facts).toHaveLength(factCount + 1);
    expect(log.facts.some(fact => fact.payload.type === "turnStarted" && fact.payload.turnId === uuid(30))).toBe(true);
    expect(applyAgentEvents(createAgentConversationProjection(conversationId), log.facts)).toEqual(log.state);
    const marker = log.facts.at(-1);
    if (!marker) throw new Error("missing rollback fixture");
    expect(applyAgentEvents(log.state, [marker])).toBe(log.state);
    // Duplicate seq is idempotent even when that old event has different payload.
    expect(applyAgentEvents(log.state, [{ ...marker, payload: { type: "conversationRolledBack", turnId: uuid(999), userTurns: 100 } }])).toBe(log.state);
    const firstRollback = log.state, oldTombstones = new Set(firstRollback.rolledBackTurnIds);
    log.emit({ type: "conversationRolledBack", turnId: uuid(20), userTurns: 1 });
    expect(log.state.turnOrder).toEqual([]);
    expect(log.state.turns.size).toBe(0);
    expect(firstRollback.rolledBackTurnIds).toEqual(oldTombstones);
    expect(log.state.rolledBackTurnIds).toEqual(new Set([uuid(30), uuid(40), uuid(10), uuid(20)]));
    log.turn(50, 1);
    expect(log.state.turnOrder).toEqual([uuid(50)]);
  });

  it("keeps removed turn and item identities reserved for starts and atomic acceptance", () => {
    const log = history(); log.turn(10, 1); log.turn(20, 1);
    log.emit({ type: "conversationRolledBack", turnId: uuid(20), userTurns: 1 });
    rejects(log.state, { type: "turnStarted", turnId: uuid(20), contextSnapshotId: uuid(120), model });
    log.emit({ type: "turnStarted", turnId: uuid(30), contextSnapshotId: uuid(130), model });
    rejects(log.state, { type: "itemStarted", turnId: uuid(30), itemId: uuid(20_000), kind: { type: "userMessage" } });
    rejects(log.state, { type: "itemAccepted", turnId: uuid(30), itemId: uuid(20_000), kind: { type: "assistantMessage" }, text: "cannot reuse", phase: null, source: null });
    log.emit({ type: "itemAccepted", turnId: uuid(30), itemId: uuid(30_000), kind: { type: "assistantMessage" }, text: "new identity", phase: null, source: null });
    log.emit({ type: "turnFinished", turnId: uuid(30), outcome: "completed" });
    expect(log.state.turnOrder).toEqual([uuid(10), uuid(30)]);
  });

  it("rejects active, stale, zero, excessive and user-free rollbacks without partial mutation", () => {
    const log = history(); log.turn(10, 1); log.turn(20, 0);
    for (const [turnId, userTurns] of [[uuid(10), 1], [uuid(20), 0], [uuid(20), 2]] as const) {
      // Zero is already rejected by the wire decoder; exercise projection's
      // already-decoded input guard separately to preserve Rust's condition.
      const before = snapshot(log.state);
      const input: AgentEvent = { schemaVersion: 1, conversationId, requestId, seq: log.state.seq + 1, timestampMs: 1,
        payload: { type: "conversationRolledBack", turnId, userTurns } };
      expect(() => applyAgentEvents(log.state, [input])).toThrow(AgentProjectionError);
      expect(snapshot(log.state)).toBe(before);
    }
    const empty = history(); empty.turn(10, 0);
    rejects(empty.state, { type: "conversationRolledBack", turnId: uuid(10), userTurns: 1 });
    log.emit({ type: "turnStarted", turnId: uuid(30), contextSnapshotId: uuid(130), model });
    rejects(log.state, { type: "conversationRolledBack", turnId: uuid(30), userTurns: 1 });
  });

  it("counts an interrupted empty user item regardless of taskKind or terminal outcome", () => {
    for (const outcome of ["failed", "canceled"] as const) {
      const log = history(); log.turn(10, 1);
      log.emit({ type: "turnStarted", turnId: uuid(20), contextSnapshotId: uuid(120), model, taskKind: "compact" });
      log.emit({ type: "itemStarted", turnId: uuid(20), itemId: uuid(20_000), kind: { type: "userMessage" } });
      log.emit({ type: "turnFinished", turnId: uuid(20), outcome });
      log.emit({ type: "conversationRolledBack", turnId: uuid(20), userTurns: 1 });
      expect(log.state.turnOrder).toEqual([uuid(10)]);
    }
  });

  it("does not let rollback erase a tool with an unknown outcome", () => {
    for (const accepted of [true, false]) {
      const log = history(); log.turn(10, 1);
      const turnId = uuid(20), itemId = uuid(20_000), callId = uuid(9000);
      log.emit({ type: "turnStarted", turnId, contextSnapshotId: uuid(120), model });
      if (accepted) {
        log.emit({ type: "itemAccepted", turnId, itemId, kind: { type: "toolCall", callId, name: "write" }, text: "{}", phase: null, source: null });
      } else {
        log.emit({ type: "itemStarted", turnId, itemId, kind: { type: "toolCall", callId, name: "write" } });
        log.emit({ type: "itemCompleted", turnId, itemId });
        log.emit({ type: "turnFailed", turnId, error: "outcome unknown", category: "recovery" });
      }
      log.emit({ type: "turnFinished", turnId, outcome: "failed" });
      rejects(log.state, { type: "conversationRolledBack", turnId, userTurns: 1 });
    }
  });

  it("allows a reconciled tool result and a legacy nonaccepted call without inventing tool undo", () => {
    for (const resolved of [true, false]) {
      const log = history(); log.turn(10, 1);
      const turnId = uuid(20), itemId = uuid(20_000), callId = uuid(9000);
      log.emit({ type: "turnStarted", turnId, contextSnapshotId: uuid(120), model });
      if (resolved) {
        log.emit({ type: "itemAccepted", turnId, itemId, kind: { type: "toolCall", callId, name: "write" }, text: "{}", phase: null, source: null });
        log.emit({ type: "itemAccepted", turnId, itemId: uuid(20_001), kind: { type: "toolResult", callId }, text: "saved", phase: null, source: null });
      } else {
        log.emit({ type: "itemStarted", turnId, itemId, kind: { type: "toolCall", callId, name: "write" } });
        log.emit({ type: "itemCompleted", turnId, itemId });
      }
      log.emit({ type: "turnFinished", turnId, outcome: "failed" });
      const facts = [...log.facts];
      log.emit({ type: "conversationRolledBack", turnId, userTurns: 1 });
      expect(log.state.turnOrder).toEqual([]);
      expect(log.facts.slice(0, -1)).toEqual(facts);
    }
  });

  it("retains conversation and sequence validation around the rollback branch", () => {
    const log = history(); log.turn(10, 1);
    const marker = event(log.state, { type: "conversationRolledBack", turnId: uuid(10), userTurns: 1 });
    expect(() => applyAgentEvents(log.state, [{ ...marker, conversationId: uuid(2) }])).toThrow("wrongConversation");
    expect(() => applyAgentEvents(log.state, [{ ...marker, seq: marker.seq + 1 }])).toThrow("gap");
    expect(log.state.turnOrder).toEqual([uuid(10)]);
  });
});
