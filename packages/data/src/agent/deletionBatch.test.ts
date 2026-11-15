import {expect, it, vi} from "vitest";
import {createAgentDeletionBatchGateway} from "./deletionBatch";

const first = {schemaVersion: 1 as const, requestId: "11111111-1111-4111-8111-111111111111",
  conversationId: "22222222-2222-4222-8222-222222222222", binding: null,
  expectedTitle: "First", expectedDurableCount: 3, force: true};
const second = {...first, requestId: "33333333-3333-4333-8333-333333333333",
  conversationId: "44444444-4444-4444-8444-444444444444", expectedTitle: "Second"};

it("submits one frozen batch and preserves per-conversation failures", async () => {
  const response = {schemaVersion: 1, results: [
    {requestId: first.requestId, conversationId: first.conversationId, status: "deleted", cleanupPending: true},
    {requestId: second.requestId, conversationId: second.conversationId, status: "failed", error: "busy"},
  ]};
  const invoke = vi.fn().mockResolvedValue(response);
  const gateway = createAgentDeletionBatchGateway(invoke);
  expect(await gateway.deleteBatch([first, second])).toEqual(response);
  expect(invoke).toHaveBeenCalledExactlyOnceWith("agent_delete_conversations_batch", {requests: [first, second]});
});

it("rejects duplicate inputs and incomplete or mismatched receipts", async () => {
  const invoke = vi.fn(), gateway = createAgentDeletionBatchGateway(invoke);
  await expect(gateway.deleteBatch([first, {...second, conversationId: first.conversationId}])).rejects.toThrow();
  expect(invoke).not.toHaveBeenCalled();
  for (const results of [[], [{requestId: first.requestId, conversationId: second.conversationId, status: "deleted"}],
    [{requestId: first.requestId, conversationId: first.conversationId, status: "failed"}]]) {
    invoke.mockResolvedValueOnce({schemaVersion: 1, results});
    await expect(gateway.deleteBatch([first])).rejects.toThrow();
  }
});

it("does not replay an interrupted batch", async () => {
  const invoke = vi.fn().mockRejectedValue("unavailable"), gateway = createAgentDeletionBatchGateway(invoke);
  await expect(gateway.deleteBatch([first, second])).rejects.toBe("unavailable");
  expect(invoke).toHaveBeenCalledOnce();
});
