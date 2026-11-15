import { expect, it, vi } from "vitest";
import { createAgentCreationGateway } from "../../packages/data/src/agent/index";
import { AgentCatalogDecodeError } from "../../packages/core/src/agent/index";
const id = "11111111-1111-4111-8111-111111111111", operationId = "22222222-2222-4222-8222-222222222222";
const epoch = "33333333-3333-4333-8333-333333333333";
const request = {operationId, id, binding: {kind: "manuscript" as const, resourceId: "one"}};
const proof = {schemaVersion: 1, operationId, conversationId: id, family: "agent.conversation.create_bound", epoch,
  sqlFence: "9007199254740993", replayed: true, result: null};
const envelope = {schemaVersion: 1, operationId, conversationId: id};

it("returns historical proof using only the atomic command, without reading metadata or starting a runtime", async () => {
  const invoke = vi.fn(async () => proof);
  expect(await createAgentCreationGateway(invoke).createBound(request)).toEqual(proof);
  expect(invoke).toHaveBeenCalledExactlyOnceWith("agent_create_bound_conversation", {request});
});
it("freezes the entire intent before asynchronous IPC", async () => {
  let resolve!: (value: unknown) => void;
  const invoke = vi.fn(() => new Promise<unknown>(done => { resolve = done; }));
  const mutable = structuredClone(request), pending = createAgentCreationGateway(invoke).createBound(mutable);
  mutable.id = epoch; mutable.operationId = epoch; mutable.binding.resourceId = "different";
  expect(invoke).toHaveBeenCalledExactlyOnceWith("agent_create_bound_conversation", {request});
  resolve(proof); expect(await pending).toEqual(proof);
});
it("validates before IPC and rejects a response for another operation, conversation or family", async () => {
  const invoke = vi.fn(async (): Promise<unknown> => proof), gateway = createAgentCreationGateway(invoke);
  for (const patch of [{operationId: "bad"}, {id: "00000000-0000-0000-0000-000000000000"}])
    await expect(gateway.createBound({...request, ...patch})).rejects.toBeInstanceOf(AgentCatalogDecodeError);
  expect(invoke).not.toHaveBeenCalled();
  for (const patch of [{operationId: epoch}, {conversationId: epoch}, {family: "agent.conversation.rename"}]) {
    invoke.mockResolvedValueOnce({...proof, ...patch});
    await expect(gateway.createBound(request)).rejects.toBeInstanceOf(AgentCatalogDecodeError);
  }
});
it("passes Unknown through without retry, status or metadata queries", async () => {
  const unknown = {code: "storage", reason: {code: "DATA_SQL_UNKNOWN"}};
  const invoke = vi.fn(async () => { throw unknown; });
  await expect(createAgentCreationGateway(invoke).createBound(request)).rejects.toBe(unknown);
  expect(invoke).toHaveBeenCalledTimes(1);
});
it("inspects each status using the full original intent and no follow-up action", async () => {
  const invoke = vi.fn(async (): Promise<unknown> => null), gateway = createAgentCreationGateway(invoke);
  for (const status of [{type: "committed", proof}, {type: "noSqlReceipt", epoch, sqlFence: "0", closed: false},
    {type: "unconfirmed", epoch, sqlFence: "0", blocked: true, closed: false, reason: "sql_owner_blocked"}]) {
    invoke.mockResolvedValueOnce({...envelope, status});
    expect(await gateway.createBoundStatus(request)).toEqual({...envelope, status});
  }
  expect(invoke.mock.calls).toEqual(Array.from({length: 3}, () => ["agent_read_bound_conversation_creation_status", {request}]));
  invoke.mockResolvedValueOnce({...envelope, operationId: epoch, status: {type: "noSqlReceipt", epoch, sqlFence: "0", closed: true}});
  await expect(gateway.createBoundStatus(request)).rejects.toBeInstanceOf(AgentCatalogDecodeError);
});
