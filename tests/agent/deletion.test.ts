import { describe, expect, it, vi } from "vitest";
import { agentDeletionErrors, decodeAgentDeletionRequest, decodeAgentDeletionResponse } from "../../packages/core/src/agent/index";
import { createAgentDeletionGateway } from "../../packages/data/src/agent/deletion";
import fixture from "../fixtures/agent/conversation-deletion.json";

describe("conversation deletion contract", () => {
  it("matches the native fixture including retention errors", () => {
    expect(decodeAgentDeletionRequest(fixture.request)).toEqual(fixture.request);
    expect(decodeAgentDeletionResponse(fixture.response)).toEqual(fixture.response);
    expect(agentDeletionErrors).toEqual(fixture.errors);
  });
  it("rejects invalid confirmation and arbitrary capability fields before invoking", async () => {
    const invoke = vi.fn(); const gateway = createAgentDeletionGateway(invoke);
    const values = [
      { ...fixture.request, schemaVersion: 2 }, { ...fixture.request, force: "yes" },
      { ...fixture.request, requestId: "00000000-0000-0000-0000-000000000000" },
      { ...fixture.request, expectedTitle: " " }, { ...fixture.request, expectedTitle: "x\0" },
      { ...fixture.request, expectedTitle: "😀".repeat(181) },
      { ...fixture.request, binding: { ...fixture.request.binding, resourceId: " " } },
      { ...fixture.request, binding: { ...fixture.request.binding, deleteFiles: true } },
      ...[-1, 0.5, NaN, Number.MAX_SAFE_INTEGER + 1].map((expectedDurableCount) => ({ ...fixture.request, expectedDurableCount })),
    ];
    for (const value of values) await expect(gateway.delete(value as never)).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
    expect(decodeAgentDeletionRequest({ ...fixture.request, expectedTitle: "😀".repeat(180) }).expectedTitle).toHaveLength(360);
  });
  it("invokes once, requires exact receipt and preserves errors for explicit retry", async () => {
    const invoke = vi.fn().mockResolvedValue(fixture.response);
    const gateway = createAgentDeletionGateway(invoke);
    const request = decodeAgentDeletionRequest(fixture.request);
    await expect(gateway.delete(request)).resolves.toEqual(fixture.response);
    expect(invoke).toHaveBeenCalledExactlyOnceWith("agent_delete_conversation", { request });
    for (const field of ["requestId", "conversationId"]) {
      invoke.mockResolvedValueOnce({ ...fixture.response, [field]: "00000000-0000-0000-0000-000000000099" });
      await expect(gateway.delete(request)).rejects.toThrow();
    }
    invoke.mockRejectedValueOnce("executionWorkspace");
    await expect(gateway.delete(request)).rejects.toBe("executionWorkspace");
    expect(invoke).toHaveBeenCalledTimes(4);
    await expect(gateway.delete(request)).resolves.toEqual(fixture.response);
    expect(invoke.mock.calls[4]?.[1]).toEqual({ request });
  });
  it("rejects malformed or augmented receipts", () => {
    for (const value of [{ ...fixture.response, schemaVersion: 2 }, { ...fixture.response, deletedFiles: [] }, { ...fixture.response, requestId: null }]) {
      expect(() => decodeAgentDeletionResponse(value)).toThrow();
    }
  });
});
