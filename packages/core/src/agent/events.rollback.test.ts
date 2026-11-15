import { describe, expect, it } from "vitest";
import { AgentEventDecodeError, decodeAgentEvent } from "./events";

const event = {
  schemaVersion: 1,
  conversationId: "11111111-1111-4111-8111-111111111111",
  seq: 15,
  timestampMs: 1,
  requestId: "22222222-2222-4222-8222-222222222222",
  payload: { type: "conversationRolledBack", turnId: "33333333-3333-4333-8333-333333333333", userTurns: 1 },
};

describe("Rust rollback event wire contract", () => {
  it.each([1, 0xffff_ffff])("preserves positive u32 user turn counts (%s)", userTurns => {
    const wire = { ...event, payload: { ...event.payload, userTurns } };
    expect(decodeAgentEvent(wire)).toEqual(wire);
  });

  it.each([0, -1, 1.5, 0x1_0000_0000, "1", null, undefined, Number.NaN, Infinity])(
    "rejects counts outside the Rust positive u32 domain (%s)", userTurns => {
      expect(() => decodeAgentEvent({ ...event, payload: { ...event.payload, userTurns } }))
        .toThrow(AgentEventDecodeError);
    },
  );

  it("rejects nil targets and unexpected rollback fields without exposing values", () => {
    for (const patch of [{ turnId: "00000000-0000-0000-0000-000000000000" }, { extra: "private text" }]) {
      expect(() => decodeAgentEvent({ ...event, payload: { ...event.payload, ...patch } }))
        .toThrow("Invalid or unsupported agent event");
    }
  });
});
