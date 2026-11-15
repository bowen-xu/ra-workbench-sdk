import { expect, it, vi } from "vitest";
import { createAgentDeletionGateway } from "./deletion";
const requestId = "00000000-0000-4000-8000-000000000001", conversationId = "00000000-0000-4000-8000-000000000002";
const epoch = "00000000-0000-4000-8000-000000000003";
const request = {schemaVersion: 1 as const, requestId, conversationId, binding: null,
  expectedTitle: "Synthetic original title", expectedDurableCount: 4, force: true};
const response = {schemaVersion: 1, operationId: requestId, conversationId,
  status: {type: "noSqlReceipt", epoch, sqlFence: "0", closed: false}};
it("sends the full original confirmation only to status and never follows missing evidence with delete", async () => {
  const invoke = vi.fn().mockResolvedValue(response), gateway = createAgentDeletionGateway(invoke);
  expect(await gateway.status(request)).toEqual(response);
  expect(invoke).toHaveBeenCalledExactlyOnceWith("agent_read_conversation_deletion_status", {request});
  expect(request).not.toHaveProperty("expectedEpoch");
});
it("rejects either mismatched identity and propagates lookup failures without any implicit retry", async () => {
  const invoke = vi.fn(), gateway = createAgentDeletionGateway(invoke);
  for (const patch of [{operationId: epoch}, {conversationId: epoch}]) {
    invoke.mockResolvedValueOnce({...response, ...patch});
    await expect(gateway.status(request)).rejects.toThrow();
  }
  invoke.mockRejectedValueOnce({code: "transport_unknown"});
  await expect(gateway.status(request)).rejects.toEqual({code: "transport_unknown"});
  expect(invoke).toHaveBeenCalledTimes(3);
  expect(invoke.mock.calls.every(([command]) => command === "agent_read_conversation_deletion_status")).toBe(true);
});
it("keeps the old delete payload and carries epoch only when explicitly supplied", async () => {
  const ack = {schemaVersion: 1, requestId, conversationId}, invoke = vi.fn().mockResolvedValue(ack);
  const gateway = createAgentDeletionGateway(invoke);
  expect(await gateway.delete(request)).toEqual(ack);
  expect(invoke).toHaveBeenLastCalledWith("agent_delete_conversation", {request});
  expect(await gateway.delete(request, {expectedEpoch: epoch})).toEqual(ack);
  expect(invoke).toHaveBeenLastCalledWith("agent_delete_conversation", {request: {...request, expectedEpoch: epoch}});
  await expect(gateway.delete(request, {expectedEpoch: "invalid"})).rejects.toThrow();
  expect(invoke).toHaveBeenCalledTimes(2); expect(request).not.toHaveProperty("expectedEpoch");
});
it("rejects malformed confirmation before IPC and does not replace a failed write with an unfenced one", async () => {
  const invoke = vi.fn().mockRejectedValue("write_outcome_unknown"), gateway = createAgentDeletionGateway(invoke);
  await expect(gateway.status({...request, expectedDurableCount: -1})).rejects.toThrow();
  expect(invoke).not.toHaveBeenCalled();
  await expect(gateway.delete(request, {expectedEpoch: epoch})).rejects.toBe("write_outcome_unknown");
  expect(invoke).toHaveBeenCalledExactlyOnceWith("agent_delete_conversation", {request: {...request, expectedEpoch: epoch}});
});
