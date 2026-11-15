import { expect, it, vi } from "vitest";
import { createAgentQueueAdmissionsGateway } from "../../packages/data/src/agent";
import { decodeAgentQueueAdmissionsPage } from "../../packages/core/src/agent";
const id = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const scope = { conversationId: id, manuscriptId: id };
const item = { inputId: id, expectedRevision: 7, preview: { schemaVersion: 1, ...scope, requestId: id, turnId: id, contextSnapshotId: id,
  input: { text: "frozen", model: { providerId: "fixture", modelId: "test", revision: null }, reasoningEffort: null, context: [] } } };
const page = { schemaVersion: 1, ...scope, items: [item], nextCursor: id };
it("routes scoped recovery pagination and retains the original confirmation identity", async () => {
  const invoke = vi.fn().mockResolvedValue(page); const gateway = createAgentQueueAdmissionsGateway(invoke);
  const request = { ...scope, after: null, limit: 1 };
  expect(await gateway.list(request)).toEqual(page);
  expect(invoke).toHaveBeenCalledWith("agent_list_unstarted_writing_queue_admissions", { request });
  invoke.mockResolvedValue({ ...page, items: [], nextCursor: null });
  expect((await gateway.list({ ...request, after: id })).items).toEqual([]);
  invoke.mockResolvedValue(page);
  await expect(gateway.list({ ...request, after: id })).rejects.toThrow();
  const count = invoke.mock.calls.length;
  await expect(gateway.list({ ...request, limit: 65 })).rejects.toThrow();
  expect(invoke).toHaveBeenCalledTimes(count);
});
it("rejects mixed scopes, duplicate identities, invalid revisions and cursors", () => {
  for (const value of [{ ...page, schemaVersion: 2 }, { ...page, nextCursor: other },
    { ...page, items: [item, item] }, { ...page, items: [{ ...item, expectedRevision: Number.MAX_SAFE_INTEGER + 1 }] },
    { ...page, items: [{ ...item, preview: { ...item.preview, manuscriptId: other } }] },
    { ...page, credentials: "extra" }, { ...page, items: [], nextCursor: id }]) {
    expect(() => decodeAgentQueueAdmissionsPage(value)).toThrow();
  }
});
it("rejects a valid page belonging to another requested scope", async () => {
  const gateway = createAgentQueueAdmissionsGateway(vi.fn().mockResolvedValue(page));
  await expect(gateway.list({ conversationId: other, manuscriptId: id, after: null, limit: 1 })).rejects.toThrow();
});
