import { expect, it, vi } from "vitest";
import { createAgentCatalogGateway } from "./index";

const request = {operationId: "00000000-0000-0000-0000-000000000001", id: "00000000-0000-0000-0000-000000000002", expectedTitle: "A", title: "B"};
const proof = {schemaVersion: 1, operationId: request.operationId, conversationId: request.id, family: "agent.conversation.rename",
  epoch: "00000000-0000-0000-0000-000000000003", sqlFence: "9007199254740993", replayed: false, result: null};

it("returns only the immutable proof and never reads or rewrites a current summary", async () => {
  const invoke = vi.fn().mockResolvedValue(proof), gateway = createAgentCatalogGateway(invoke);
  expect(await gateway.rename(request)).toEqual(proof);
  invoke.mockResolvedValue({...proof, replayed: true});
  expect(await gateway.rename(request)).toEqual({...proof, replayed: true});
  expect(invoke.mock.calls).toEqual([["agent_rename_conversation", {request}], ["agent_rename_conversation", {request}]]);
});
it("freezes the complete intent before native IO rather than observing caller mutations", async () => {
  let resolve!: (value: unknown) => void;
  const invoke = vi.fn(() => new Promise<unknown>(done => { resolve = done; })), gateway = createAgentCatalogGateway(invoke);
  const mutable = {...request, title: " B "}, original = {...mutable}, result = gateway.rename(mutable);
  mutable.title = "another title"; mutable.operationId = proof.epoch;
  resolve(proof);
  expect(await result).toEqual(proof);
  expect(invoke).toHaveBeenCalledExactlyOnceWith("agent_rename_conversation", {request: original});
});
it("rejects corrupt or foreign proofs without retrying the operation", async () => {
  const invoke = vi.fn(), gateway = createAgentCatalogGateway(invoke);
  for (const patch of [{operationId: proof.epoch}, {conversationId: proof.epoch}, {family: "agent.rollback_authority"}, {result: {title: "B"}}]) {
    invoke.mockClear().mockResolvedValue({...proof, ...patch});
    await expect(gateway.rename(request)).rejects.toThrow("Invalid or unsupported agent catalog response");
    expect(invoke).toHaveBeenCalledTimes(1);
  }
});
it("passes an Unknown diagnostic through unchanged and does not query or retry automatically", async () => {
  const unknown = {code: "storage", reason: {code: "DATA_SQL_COMMIT_UNKNOWN", reason: {operationId: request.operationId}}};
  const invoke = vi.fn().mockRejectedValue(unknown), gateway = createAgentCatalogGateway(invoke);
  await expect(gateway.rename(request)).rejects.toBe(unknown);
  expect(invoke).toHaveBeenCalledTimes(1);
});
it("inspects blocked/missing/committed status with the original intent and no implicit metadata read", async () => {
  const invoke = vi.fn(), gateway = createAgentCatalogGateway(invoke);
  for (const status of [{type: "committed", proof: {...proof, replayed: true}},
    {type: "noSqlReceipt", epoch: proof.epoch, sqlFence: "0", closed: false},
    {type: "unconfirmed", epoch: proof.epoch, sqlFence: "0", blocked: true, closed: false, reason: "owner_blocked_receipt_unconfirmed"}]) {
    const response = {schemaVersion: 1, operationId: request.operationId, conversationId: request.id, status};
    invoke.mockClear().mockResolvedValue(response);
    expect(await gateway.renameStatus(request)).toEqual(response);
    expect(invoke).toHaveBeenCalledExactlyOnceWith("agent_read_conversation_rename_status", {request});
  }
});
it("rejects another operation's status and invalid requests before a write", async () => {
  const invoke = vi.fn().mockResolvedValue({schemaVersion: 1, operationId: proof.epoch, conversationId: request.id,
    status: {type: "noSqlReceipt", epoch: proof.epoch, sqlFence: "0", closed: false}});
  const gateway = createAgentCatalogGateway(invoke);
  await expect(gateway.renameStatus(request)).rejects.toThrow();
  invoke.mockClear();
  await expect(gateway.rename({...request, operationId: "bad"})).rejects.toThrow();
  expect(invoke).not.toHaveBeenCalled();
});
