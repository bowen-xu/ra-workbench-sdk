import { expect, it } from "vitest";
import { decodeAgentInterruptResponse } from "../../packages/core/src/agent";
import { createAgentTurnGateway } from "../../packages/data/src/agent";
import fixtures from "../fixtures/agent-interrupt-v1.json";

it("decodes native cancellation acknowledgements without treating them as terminal events", () => {
  expect(fixtures.map(decodeAgentInterruptResponse)).toEqual(fixtures);
  for (const patch of [{ schemaVersion: 2 }, { turnId: "invalid" }, { conversationId: "invalid" },
    { cancellationRequested: "true" }, { cancellationRequested: undefined }, { outcome: "canceled" }]) {
    expect(() => decodeAgentInterruptResponse({ ...fixtures[0], ...patch })).toThrow();
  }
});
it("invokes the narrow command and fences acknowledgements from other turns or conversations", async () => {
  const request = { conversationId: fixtures[0].conversationId, turnId: fixtures[0].turnId };
  const gateway = createAgentTurnGateway(async (command, args) => {
    expect(command).toBe("agent_interrupt_turn");
    expect(args).toEqual({ request });
    return fixtures[0];
  });
  await expect(gateway.interrupt(request)).resolves.toEqual(fixtures[0]);
  for (const key of ["conversationId", "turnId"]) {
    const wrong = createAgentTurnGateway(async () => ({ ...fixtures[0], [key]: "99999999-9999-4999-8999-999999999999" }));
    await expect(wrong.interrupt(request)).rejects.toThrow();
  }
});
