import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeAgentEvent } from "../../packages/core/src/agent";

const fixture: unknown[] = JSON.parse(readFileSync(new URL("../fixtures/agent-events-v1.json", import.meta.url), "utf8"));

describe("Rust-owned agent wire events", () => {
  it.each(["x", "🦀"])("keeps the existing 256-character tool name and provider call ID boundary (%s)", character => {
    const initial = decodeAgentEvent(fixture[0]);
    const maximum = character.repeat(256);
    const kind = { type: "toolCall", callId: initial.requestId, name: maximum, providerCallId: maximum };
    for (const type of ["itemStarted", "itemAccepted"] as const) {
      const payload = { type, turnId: initial.requestId, itemId: initial.requestId, kind,
        ...(type === "itemAccepted" ? { text: "{", phase: null, source: null } : {}) };
      expect(decodeAgentEvent({ ...initial, payload }).payload).toEqual(payload);
      for (const field of ["name", "providerCallId"] as const) {
        expect(() => decodeAgentEvent({ ...initial, payload: { ...payload,
          kind: { ...kind, [field]: character.repeat(257) } } }))
          .toThrow("Invalid or unsupported agent event");
      }
    }
  });
  it("preserves legacy unknown status and validates new tool provenance", () => {
    const initial = decodeAgentEvent(fixture[0]);
    const kind = { type: "toolResult", callId: initial.requestId };
    const payload = { type: "itemStarted", turnId: initial.requestId, itemId: initial.requestId, kind };
    const decode = (value: unknown) => decodeAgentEvent({ ...initial, payload: { ...payload, kind: value } }).payload;
    expect(decode(kind)).toEqual(payload);
    expect(decode({ ...kind, isError: true })).toEqual({ ...payload, kind: { ...kind, isError: true } });
    expect(() => decode({ ...kind, isError: "false" })).toThrow();
    expect(() => decode({ ...kind, providerCallId: "wrong-kind" })).toThrow();
    expect(() => decode({ type: "toolCall", callId: initial.requestId, name: "read", providerCallId: "" })).toThrow();
  });
  it("decodes and preserves every event in the Rust exported fixture", () => {
    expect(fixture.map(decodeAgentEvent)).toEqual(fixture);
    expect(new Set(fixture.map(decodeAgentEvent).map((event) => event.payload.type)).size).toBe(14);
  });
  it("rejects unknown schemas, lossy numbers, wrong identities and unexpected fields", () => {
    const initial = decodeAgentEvent(fixture[0]);
    for (const patch of [{ schemaVersion: 2 }, { seq: 0 }, { seq: Number.MAX_SAFE_INTEGER + 1 },
      { timestampMs: -1 }, { conversationId: "wrong" }, { secret: "unexpected" }]) {
      expect(() => decodeAgentEvent({ ...initial, ...patch })).toThrow();
    }
  });
  it("checks nested payloads without exposing their contents in the error", () => {
    const event = decodeAgentEvent(fixture[2]);
    for (const patch of [{ text: "" }, { text: "a".repeat(65_537) }, { type: "unknown" }, { extra: true }]) {
      expect(() => decodeAgentEvent({ ...event, payload: { ...event.payload, ...patch } })).toThrow("Invalid or unsupported agent event");
    }
  });
});
