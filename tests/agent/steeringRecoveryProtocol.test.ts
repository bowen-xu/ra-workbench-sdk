import { expect, it, vi } from "vitest";
import { decodeAgentWritingRecoveryResponse } from "../../packages/core/src/agent";
import { createAgentSteeringRecoveryGateway } from "../../packages/data/src/agent";

const id = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const request = { conversationId: id, manuscriptId: id, turnId: id };
const response = { schemaVersion: 1, ...request, inputs: [{ inputId: other, text: "原样恢复 🧬\n" }] };

it("preserves text and checks every returned scope before exposing recovery", async () => {
  const invoke = vi.fn().mockResolvedValue(response);
  const gateway = createAgentSteeringRecoveryGateway(invoke);
  expect(await gateway.readWritingRecovery(request)).toEqual(response);
  expect(invoke).toHaveBeenCalledWith("agent_read_writing_steering_recovery", { request });
  for (const field of ["conversationId", "manuscriptId", "turnId"]) {
    invoke.mockResolvedValue({ ...response, [field]: other });
    await expect(gateway.readWritingRecovery(request)).rejects.toThrow();
  }
});

it("rejects future versions, duplicate identities, oversized text and added fields", () => {
  for (const value of [
    { ...response, schemaVersion: 2 }, { ...response, model: "unexpected" },
    { ...response, inputs: [response.inputs[0], response.inputs[0]] },
    { ...response, inputs: Array(65).fill(response.inputs[0]) },
    ...["", "  ", "🧬".repeat(16385), "\ud800"].map((text) => ({ ...response, inputs: [{ inputId: other, text }] })),
    { ...response, inputs: [{ ...response.inputs[0], model: "override" }] },
  ]) expect(() => decodeAgentWritingRecoveryResponse(value)).toThrow();
  expect(decodeAgentWritingRecoveryResponse({ ...response, inputs: [] }).inputs).toEqual([]);
});

it("does not resubmit or retry when recovery is unavailable", async () => {
  const failure = { code: "closed" };
  const invoke = vi.fn().mockRejectedValue(failure);
  await expect(createAgentSteeringRecoveryGateway(invoke).readWritingRecovery(request)).rejects.toBe(failure);
  expect(invoke).toHaveBeenCalledTimes(1);
});
