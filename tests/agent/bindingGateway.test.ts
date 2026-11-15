import { expect, it, vi } from "vitest";
import { createAgentCatalogGateway, createAgentCreationGateway } from "../../packages/data/src/agent";
import fixture from "../fixtures/agent-catalog-v1.json";

it("passes the host binding through atomic creation and directory reads", async () => {
  const binding = { kind: "manuscript" as const, resourceId: "draft-one" };
  const request = { operationId: crypto.randomUUID(), id: fixture.conversations[0].id, binding };
  const proof = {schemaVersion: 1, operationId: request.operationId, conversationId: request.id,
    family: "agent.conversation.create_bound", epoch: crypto.randomUUID(), sqlFence: "0", replayed: false, result: null};
  const invoke = vi.fn().mockResolvedValueOnce(proof).mockResolvedValueOnce(fixture);
  const gateway = createAgentCatalogGateway(invoke);
  await expect(createAgentCreationGateway(invoke).createBound(request)).resolves.toEqual(proof);
  expect(invoke).toHaveBeenNthCalledWith(1, "agent_create_bound_conversation", { request });
  await gateway.list({ archived: false, limit: 1, before: null, binding });
  expect(invoke).toHaveBeenNthCalledWith(2, "agent_list_conversations", { request: { archived: false, limit: 1, before: null, binding } });
});
