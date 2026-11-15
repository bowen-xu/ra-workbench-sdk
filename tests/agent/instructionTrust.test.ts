import { expect, it, vi } from "vitest";
import { decodeAgentInstructionTrust } from "../../packages/core/src/agent";
import { createAgentInstructionTrustGateway } from "../../packages/data/src/agent";
const id = "11111111-1111-4111-8111-111111111111";
const state = { schemaVersion: 1, manuscriptId: id, revision: 1, granted: true, rootMatches: true };
it("rejects invalid or cross-scope trust and preserves exact update revision", async () => {
  for (const patch of [{ device: "1" }, { revision: -1 }, { granted: false }, { revision: 0 }, { rootMatches: "true" }]) expect(() => decodeAgentInstructionTrust({ ...state, ...patch })).toThrow();
  const invoke = vi.fn(async () => state);
  const gateway = createAgentInstructionTrustGateway(invoke);
  expect(await gateway.update(id, 0, true)).toEqual(state);
  expect(invoke).toHaveBeenCalledWith("agent_update_manuscript_instruction_trust", { request: { manuscriptId: id, expectedRevision: 0, granted: true } });
  await expect(gateway.update(id, 1, true)).rejects.toThrow();
  invoke.mockResolvedValue({ ...state, manuscriptId: "22222222-2222-4222-8222-222222222222" });
  await expect(gateway.read(id)).rejects.toThrow();
  expect(invoke).toHaveBeenCalledTimes(3);
});
