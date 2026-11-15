import { expect, it, vi } from "vitest";
import { createAgentForkGateway } from "./fork";
const childId = "00000000-0000-4000-8000-000000000001", parentId = "00000000-0000-4000-8000-000000000002";
const request = { childId, parentId, throughTurnId: "00000000-0000-4000-8000-000000000003", binding: { kind: "note" as const, resourceId: "synthetic" } };
const response = { schemaVersion: 1, operationId: childId, conversationId: childId,
  status: { type: "noSqlReceipt", epoch: parentId, sqlFence: "0", closed: false } };
it("sends the complete original request only to the readonly status command", async () => {
  const invoke = vi.fn().mockResolvedValue(response), gateway = createAgentForkGateway(invoke);
  expect(await gateway.status(request)).toEqual(response);
  expect(invoke).toHaveBeenCalledExactlyOnceWith("agent_read_conversation_fork_status", { request });
});
it("rejects a different child status and never retries a failed lookup", async () => {
  const invoke = vi.fn().mockResolvedValue({ ...response, operationId: parentId, conversationId: parentId });
  await expect(createAgentForkGateway(invoke).status(request)).rejects.toThrow();
  expect(invoke).toHaveBeenCalledOnce();
  invoke.mockRejectedValueOnce("transport_unknown");
  await expect(createAgentForkGateway(invoke).status(request)).rejects.toBe("transport_unknown");
  expect(invoke).toHaveBeenCalledTimes(2);
});
it("carries the epoch precondition without changing original identity or silently dropping malformed options", async () => {
  const invoke = vi.fn().mockRejectedValue("expected native sentinel"), gateway = createAgentForkGateway(invoke);
  await expect(gateway.fork(request, {expectedEpoch: parentId})).rejects.toBe("expected native sentinel");
  expect(invoke).toHaveBeenCalledExactlyOnceWith("agent_fork_conversation", {request: {...request, expectedEpoch: parentId}});
  await expect(gateway.fork(request, {expectedEpoch: "invalid"})).rejects.toThrow(); expect(invoke).toHaveBeenCalledOnce();
  expect(request).not.toHaveProperty("expectedEpoch");
});
