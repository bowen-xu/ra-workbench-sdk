import { expect, it, vi } from "vitest";
import { createAgentWritingFileDeliveryGateway } from "./agent/writingFileDelivery";
import { decodeAgentWritingFileDeliveryPage } from "@research-assistant/core/agent";

const scope = { manuscriptId: "00000000-0000-4000-8000-000000000001", conversationId: "00000000-0000-4000-8000-000000000002",
  requestId: "00000000-0000-4000-8000-000000000003", contextSnapshotId: "00000000-0000-4000-8000-000000000004" };
const admission = { scope, turnId: "00000000-0000-4000-8000-000000000005" };
const page = { schemaVersion: 1, manuscriptId: scope.manuscriptId, items: [{ ...admission, id: 2 }], nextCursor: null };
it("uses exact workspace discovery and acknowledgement commands without starting or applying a turn", async () => {
  const invoke = vi.fn().mockResolvedValueOnce(page).mockResolvedValueOnce(null), gateway = createAgentWritingFileDeliveryGateway(invoke);
  const request = { manuscriptId: scope.manuscriptId, after: 1, limit: 64 };
  expect(await gateway.list(request)).toEqual(page);
  await gateway.acknowledge(admission);
  expect(invoke.mock.calls).toEqual([["agent_list_writing_file_deliveries", { request }], ["agent_acknowledge_writing_file_delivery", { request: admission }]]);
});
it("rejects cross-manuscript, repeated, malformed and non-progressing pagination", async () => {
  expect(() => decodeAgentWritingFileDeliveryPage({ ...page, items: [{ ...admission, id: 2, scope: { ...scope, manuscriptId: scope.conversationId } }] })).toThrow();
  expect(() => decodeAgentWritingFileDeliveryPage({ ...page, items: [page.items[0], page.items[0]] })).toThrow();
  expect(() => decodeAgentWritingFileDeliveryPage({ ...page, nextCursor: 3 })).toThrow();
  expect(() => decodeAgentWritingFileDeliveryPage({ ...page, items: [{ ...admission, id: Number.MAX_SAFE_INTEGER + 1 }] })).toThrow();
  const invoke = vi.fn(async (): Promise<unknown> => page), gateway = createAgentWritingFileDeliveryGateway(invoke);
  await expect(gateway.list({ manuscriptId: scope.manuscriptId, after: 2, limit: 1 })).rejects.toThrow();
  await expect(gateway.list({ manuscriptId: scope.conversationId, after: null, limit: 1 })).rejects.toThrow();
  invoke.mockResolvedValueOnce({ ...page, nextCursor: 2 });
  await expect(gateway.list({ manuscriptId: scope.manuscriptId, after: null, limit: 64 })).rejects.toThrow();
});
it("rejects forged authority before IPC and requires a valid acknowledgement response", async () => {
  const invoke = vi.fn(async () => ({ applied: true })), gateway = createAgentWritingFileDeliveryGateway(invoke);
  await expect(gateway.list({ manuscriptId: scope.manuscriptId, after: null, limit: 65 })).rejects.toThrow();
  await expect(gateway.acknowledge({ ...admission, emptyCopyVerified: true } as typeof admission)).rejects.toThrow();
  expect(invoke).not.toHaveBeenCalled();
  await expect(gateway.acknowledge(admission)).rejects.toThrow();
});
