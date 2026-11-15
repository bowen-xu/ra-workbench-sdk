import {expect, it, vi} from "vitest";
import type {AgentQueueEditScope, AgentQueueState, AgentSteeringHandoffIntent, AgentSteeringHandoffPage, AgentSteeringHandoffProof} from "@research-assistant/core/agent";
import {AgentSteeringHandoffRegistry} from "./steeringHandoffRegistry";

const conversationId = "11111111-1111-4111-8111-111111111111";
const turnId = "22222222-2222-4222-8222-222222222222";
const epoch = "33333333-3333-4333-8333-333333333333";
const queueInputId = "44444444-4444-4444-8444-444444444444";
const queue: AgentQueueState = {schemaVersion: 1, conversationId, revision: 0, paused: false, preparingInputId: null,
  inputs: [{inputId: queueInputId, text: "instruction", origin: {kind: "manuscript", resourceId: epoch}}]};
const scopes: readonly AgentQueueEditScope[] = [
  {kind: "manuscript", manuscriptId: epoch}, {kind: "paper", paperId: epoch},
  {kind: "note", resourceId: epoch}, {kind: "readingNote", resourceId: epoch}, {kind: "context"},
];

function fixture() {
  const items = new Map<string, AgentSteeringHandoffPage["items"][number]>();
  const proof = (intent: AgentSteeringHandoffIntent, family: AgentSteeringHandoffProof["family"]): AgentSteeringHandoffProof =>
    ({schemaVersion: 1, operationId: intent.operationId, conversationId, family, epoch, sqlFence: "0", replayed: false, result: null});
  const read = vi.fn(async (): Promise<AgentSteeringHandoffPage> => ({schemaVersion: 1, conversationId, epoch, items: [...items.values()]}));
  const prepare = vi.fn(async (intent: AgentSteeringHandoffIntent) => {
    const receipt = proof(intent, "agent.steering.handoff.prepare");
    items.set(intent.operationId, {intent, proof: receipt, history: "unconfirmed"});
    return receipt;
  });
  const finish = vi.fn(async (intent: AgentSteeringHandoffIntent) => {
    items.delete(intent.operationId);
    return proof(intent, "agent.steering.handoff.finish");
  });
  const release = vi.fn(async (intent: AgentSteeringHandoffIntent) => {
    items.delete(intent.operationId);
    return proof(intent, "agent.steering.handoff.release");
  });
  const cancelUnregistered = vi.fn(async (intent: AgentSteeringHandoffIntent) => proof(intent, "agent.steering.handoff.cancel"));
  const resolution = vi.fn(async (): Promise<"unconfirmed"> => "unconfirmed");
  const send = vi.fn(async () => ({}));
  const registry = new AgentSteeringHandoffRegistry({read, prepare, finish, release, cancelUnregistered, resolution}, send, () => crypto.randomUUID(), () => true);
  return {registry, read, prepare, finish, release, cancelUnregistered, resolution, send};
}

it.each(scopes)("queries the original $kind intent rather than its manuscript origin or key", async scope => {
  const f = fixture(), lease = f.registry.acquire(conversationId)!;
  expect(f.registry.hasPending()).toBe(false);
  await lease.controller.refresh(() => false);
  f.send.mockRejectedValueOnce(new Error("lost reply"));
  expect(await lease.controller.submit(queue, turnId, queueInputId, scope)).toBe(false);
  lease.release();
  const snapshot = lease.controller.getSnapshot();
  const calls = [f.read, f.prepare, f.finish, f.release, f.cancelUnregistered, f.resolution, f.send].map(mock => mock.mock.calls.length);
  expect(f.registry.hasPending()).toBe(true);
  for (const candidate of scopes) expect(f.registry.hasPending(candidate.kind)).toBe(candidate.kind === scope.kind);
  expect(lease.controller.getSnapshot()).toBe(snapshot);
  expect([f.read, f.prepare, f.finish, f.release, f.cancelUnregistered, f.resolution, f.send].map(mock => mock.mock.calls.length)).toEqual(calls);
  const reattached = f.registry.acquire(conversationId)!;
  expect(reattached.controller).toBe(lease.controller);
  await reattached.controller.refresh(() => true);
  expect(f.registry.hasPending()).toBe(false);
  reattached.release(); f.registry.dispose();
});

it("conservatively blocks each scope while a pending recovery has not read its scope", async () => {
  const f = fixture(), lease = f.registry.acquire(conversationId)!;
  let resolve!: (page: AgentSteeringHandoffPage) => void;
  f.read.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const refreshing = lease.controller.refresh(() => false);
  expect(lease.controller.getSnapshot().phase).toBe("recovering");
  lease.release();
  expect(f.registry.hasPending()).toBe(true);
  for (const scope of scopes) expect(f.registry.hasPending(scope.kind)).toBe(true);
  expect(f.read).toHaveBeenCalledOnce();
  expect(f.prepare).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
  resolve({schemaVersion: 1, conversationId, epoch, items: []});
  expect(await refreshing).toBe(true);
  expect(f.registry.hasPending()).toBe(false);
  for (const scope of scopes) expect(f.registry.hasPending(scope.kind)).toBe(false);
  f.registry.dispose();
});

it("checks every stored original scope when the current intent belongs to another scope", async () => {
  const f = fixture(), lease = f.registry.acquire(conversationId)!;
  await lease.controller.refresh(() => false);
  expect(await lease.controller.submit(queue, turnId, queueInputId, {kind: "manuscript", manuscriptId: epoch})).toBe(true);
  await lease.controller.refresh(() => false);
  const second = "77777777-7777-4777-8777-777777777777";
  const next: AgentQueueState = {...queue, inputs: [...queue.inputs, {inputId: second, text: "second"}]};
  expect(await lease.controller.submit(next, turnId, second, {kind: "note", resourceId: epoch})).toBe(true);
  expect(lease.controller.getSnapshot().intent?.scope.kind).toBe("note");
  expect(f.registry.hasPending("manuscript")).toBe(true);
  expect(f.registry.hasPending("note")).toBe(true);
  expect(f.registry.hasPending("context")).toBe(false);
  await lease.controller.refresh(() => true);
  expect(f.registry.hasPending()).toBe(false);
  lease.release(); f.registry.dispose();
});
