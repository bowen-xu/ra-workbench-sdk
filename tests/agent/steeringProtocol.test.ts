import { describe, expect, it, vi } from "vitest";
import { decodeAgentWritingSteerResponse } from "../../packages/core/src/agent";
import { createAgentSteeringGateway } from "../../packages/data/src/agent";

const request = {
  conversationId: "00000000-0000-4000-8000-000000000001",
  manuscriptId: "00000000-0000-4000-8000-000000000002",
  turnId: "00000000-0000-4000-8000-000000000003",
  inputId: "00000000-0000-4000-8000-000000000004",
  text: "Clarify the evidence",
};
const response = { schemaVersion: 1, conversationId: request.conversationId, turnId: request.turnId, inputId: request.inputId };
describe("writing steering admission", () => {
  it("uses the supplied idempotency key and keeps admission separate from consumption", async () => {
    const invoke = vi.fn().mockResolvedValue(response);
    const gateway = createAgentSteeringGateway(invoke);
    expect(await gateway.steerWriting(request)).toEqual(response);
    expect(await gateway.steerWriting(request)).toEqual(response);
    expect(invoke).toHaveBeenLastCalledWith("agent_steer_writing_turn", { request });
  });
  it("rejects foreign response identities and unknown protocol fields", async () => {
    for (const field of ["conversationId", "turnId", "inputId"]) {
      const gateway = createAgentSteeringGateway(vi.fn().mockResolvedValue({ ...response, [field]: request.manuscriptId }));
      await expect(gateway.steerWriting(request)).rejects.toThrow();
    }
    expect(() => decodeAgentWritingSteerResponse({ ...response, schemaVersion: 2 })).toThrow();
    expect(() => decodeAgentWritingSteerResponse({ ...response, consumed: true })).toThrow();
  });
  it("preserves explicit closed-turn errors without retrying", async () => {
    const error = { code: "closed" };
    const invoke = vi.fn().mockRejectedValue(error);
    await expect(createAgentSteeringGateway(invoke).steerWriting(request)).rejects.toEqual(error);
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
