import { expect, it, vi } from "vitest";
import { createAgentMetadataGateway } from "../../packages/data/src/agent/index";
import { AgentCatalogDecodeError } from "../../packages/core/src/agent/index";
const id = "11111111-1111-4111-8111-111111111111";
const conversation = { id, title: "Archived", archived: true, durableCount: 42,
  createdAt: "2026-09-10T00:00:00.000Z", updatedAt: "2026-09-10T00:00:00.000Z" };
it("reads archived metadata with the exact host binding and no history or runtime command", async () => {
  const invoke = vi.fn(async () => ({ schemaVersion: 1, conversation }));
  const request = { id, binding: { kind: "manuscript" as const, resourceId: "one" } };
  expect(await createAgentMetadataGateway(invoke).read(request)).toEqual(conversation);
  expect(invoke).toHaveBeenCalledExactlyOnceWith("agent_read_conversation_metadata", { request });
});
it("rejects invalid identity before IPC and unexpected identities or versions after IPC", async () => {
  const invoke = vi.fn(async () => ({ schemaVersion: 1, conversation }));
  const gateway = createAgentMetadataGateway(invoke);
  for (const value of ["bad", "00000000-0000-0000-0000-000000000000"]) {
    await expect(gateway.read({ id: value })).rejects.toBeInstanceOf(AgentCatalogDecodeError);
  }
  expect(invoke).not.toHaveBeenCalled();
  invoke.mockResolvedValueOnce({ schemaVersion: 1, conversation: { ...conversation, id: "22222222-2222-4222-8222-222222222222" } });
  await expect(gateway.read({ id })).rejects.toBeInstanceOf(AgentCatalogDecodeError);
  invoke.mockResolvedValueOnce({ schemaVersion: 2, conversation });
  await expect(gateway.read({ id })).rejects.toBeInstanceOf(AgentCatalogDecodeError);
});
