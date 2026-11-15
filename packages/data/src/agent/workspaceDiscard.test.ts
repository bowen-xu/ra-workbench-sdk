import { expect, it, vi } from "vitest";
import { decodeAgentWorkspaceDiscardRecovery } from "@research-assistant/core/agent";
import { createAgentWorkspaceDiscardGateway } from "./workspaceDiscard";

const id = "a1111111-1111-4111-8111-111111111111";
const scope = { conversationId: id, requestId: id, manuscriptId: id, contextSnapshotId: id };
const receipt = { schemaVersion: 1, operationId: id,
  binding: { scope, turnId: id, leaseId: id, manifestHash: "a".repeat(64) },
  environmentId: `manuscript:${id}`, inventoryHash: "b".repeat(64), state: "pending" };
const confirmation = { operationId: id, binding: receipt.binding, environmentId: receipt.environmentId, inventoryHash: receipt.inventoryHash };
const preview = { schemaVersion: 1, confirmation, review: {schemaVersion:1,binding:receipt.binding,changes:[]} };

it("discovers original identities and distinguishes absent, pending and completed records", async () => {
  const invoke = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(receipt)
    .mockResolvedValueOnce({ ...receipt, state: "complete" });
  const gateway = createAgentWorkspaceDiscardGateway(invoke);
  expect(await gateway.find(scope)).toBeNull();
  expect(await gateway.find(scope)).toEqual(receipt);
  expect((await gateway.find(scope))?.state).toBe("complete");
  expect(invoke).toHaveBeenCalledTimes(3);
  for (const call of invoke.mock.calls) expect(call).toEqual(["agent_find_writing_workspace_discard", { request: scope }]);
});

it("previews without executing and confirms only an exact completed receipt", async () => {
  const invoke = vi.fn().mockResolvedValueOnce(preview).mockResolvedValueOnce({ ...receipt, state: "complete" });
  const gateway = createAgentWorkspaceDiscardGateway(invoke);
  expect(await gateway.preview(scope)).toEqual(preview);
  expect(invoke).toHaveBeenCalledExactlyOnceWith("agent_preview_writing_workspace_discard", {request:scope});
  expect((await gateway.discard(confirmation)).state).toBe("complete");
  expect(invoke).toHaveBeenLastCalledWith("agent_discard_writing_workspace", {request:confirmation});
});

it("refuses pending or mismatched completion and mismatched preview inventory", async () => {
  for (const patch of [{state:"pending"}, {operationId:"b1111111-1111-4111-8111-111111111111"},
    {inventoryHash:"c".repeat(64)}, {environmentId:"another"}]) {
    await expect(createAgentWorkspaceDiscardGateway(vi.fn().mockResolvedValue({...receipt,state:"complete",...patch}))
      .discard(confirmation)).rejects.toThrow();
  }
  await expect(createAgentWorkspaceDiscardGateway(vi.fn().mockResolvedValue({...preview,
    review:{...preview.review,binding:{...receipt.binding,leaseId:"b1111111-1111-4111-8111-111111111111"}}}))
    .preview(scope)).rejects.toThrow();
});

it("retains the exact confirmation across caller changes and refuses malformed input before dispatch", async () => {
  let resolve!: (value: unknown) => void;
  const invoke = vi.fn(() => new Promise(done => {resolve=done;}));
  const request = {...confirmation,binding:{...confirmation.binding,scope:{...scope}}};
  const pending = createAgentWorkspaceDiscardGateway(invoke).discard(request);
  request.inventoryHash="c".repeat(64); request.binding.scope.requestId="b1111111-1111-4111-8111-111111111111";
  resolve({...receipt,state:"complete"});
  expect((await pending).inventoryHash).toBe(receipt.inventoryHash);
  const rejected = vi.fn();
  await expect(createAgentWorkspaceDiscardGateway(rejected).discard({...confirmation,operationId:""})).rejects.toThrow();
  expect(rejected).not.toHaveBeenCalled();
});

it("rejects mismatched submission scopes, malformed receipts and unknown states", () => {
  for (const key of Object.keys(scope) as (keyof typeof scope)[]) {
    expect(() => decodeAgentWorkspaceDiscardRecovery({ ...receipt,
      binding: { ...receipt.binding, scope: { ...scope, [key]: "b1111111-1111-4111-8111-111111111111" } } }, scope)).toThrow();
  }
  for (const patch of [{ schemaVersion: 2 }, { operationId: "" }, { inventoryHash: "x" },
    { state: "unknown" }, { environmentId: "\n" }, { environmentId: "文".repeat(342) },
    { extra: true }]) {
    expect(() => decodeAgentWorkspaceDiscardRecovery({ ...receipt, ...patch }, scope)).toThrow();
  }
  expect(() => decodeAgentWorkspaceDiscardRecovery(undefined, scope)).toThrow();
  expect(() => decodeAgentWorkspaceDiscardRecovery(null, { ...scope, requestId: "" })).toThrow();
});

it("checks late replies against a frozen scope and propagates unavailable errors", async () => {
  let resolve!: (value: unknown) => void;
  const invoke = vi.fn(() => new Promise<unknown>((done) => { resolve = done; }));
  const request = { ...scope };
  const pending = createAgentWorkspaceDiscardGateway(invoke).find(request);
  request.manuscriptId = "b1111111-1111-4111-8111-111111111111";
  resolve(receipt);
  expect(await pending).toEqual(receipt);
  const error = new Error("unavailable");
  await expect(createAgentWorkspaceDiscardGateway(vi.fn().mockRejectedValue(error)).find(scope)).rejects.toBe(error);
});
