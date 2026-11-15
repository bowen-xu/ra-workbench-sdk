import { expect, it, vi } from "vitest";
import { createAgentWorkspaceSuccessorGateway } from "./workspaceSuccessor";

const id = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const scope = { conversationId: id, requestId: id, manuscriptId: id, contextSnapshotId: id };
const identity = { scope, turnId: id, generation: 1, predecessorDeliveryId: id, leaseId: id };
const confirmation = { scope, turnId: id, leaseId: id, manifestHash: "a".repeat(64) };
const buffers = [{ path: "main.tex", expectedDiskSha256: "b".repeat(64), sessionId: id, revision: id, text: "unsaved" }];

it("prepares and recovers using the same native operation identity", async () => {
  const invoke = vi.fn().mockResolvedValue(confirmation);
  const gateway = createAgentWorkspaceSuccessorGateway(invoke);
  expect(await gateway.prepare({ ...identity, buffers })).toEqual(confirmation);
  expect(invoke).toHaveBeenNthCalledWith(1, "agent_prepare_next_writing_workspace", { request: {
    scope, generation: 1, predecessorDeliveryId: id, leaseId: id, buffers,
  } });
  expect(await gateway.recover(identity)).toEqual(confirmation);
  expect(invoke).toHaveBeenNthCalledWith(2, "agent_recover_next_writing_workspace", { request: {
    scope, generation: 1, predecessorDeliveryId: id, leaseId: id,
  } });
});

it("rejects substituted scope, turn, lease and invalid generation", async () => {
  for (const response of [ { ...confirmation, turnId: other }, { ...confirmation, leaseId: other },
    { ...confirmation, scope: { ...scope, requestId: other } } ]) {
    await expect(createAgentWorkspaceSuccessorGateway(vi.fn().mockResolvedValue(response)).recover(identity)).rejects.toThrow();
  }
  const invoke = vi.fn();
  await expect(createAgentWorkspaceSuccessorGateway(invoke).recover({ ...identity, generation: 0 })).rejects.toThrow();
  expect(invoke).not.toHaveBeenCalled();
});

it("freezes identity and buffer input while the native response is pending", async () => {
  let resolve!: (value: unknown) => void;
  const invoke = vi.fn((_command: string, _args: unknown) => new Promise<unknown>(done => { resolve = done; }));
  const request = { ...identity, scope: { ...scope }, buffers: buffers.map(buffer => ({ ...buffer })) };
  const pending = createAgentWorkspaceSuccessorGateway(invoke).prepare(request);
  request.scope.requestId = other; request.buffers[0]!.text = "changed";
  resolve(confirmation);
  expect(await pending).toEqual(confirmation);
  expect(invoke.mock.calls[0]?.[1]).toEqual({ request: { scope, generation: 1, predecessorDeliveryId: id, leaseId: id, buffers } });
});
