import { expect, it, vi } from "vitest";
import type { AgentQueueState } from "@research-assistant/core/agent";
import { AgentInputQueueRegistry } from "./inputQueueRegistry";

const scope = { conversationId: "conversation", resourceId: "one", kind: "note" };
const empty: AgentQueueState = { schemaVersion: 1, conversationId: scope.conversationId, revision: 0, paused: false, preparingInputId: null, inputs: [] };
function setup() {
  const gateway = { read: vi.fn().mockResolvedValue(empty), edit: vi.fn() };
  const registry = new AgentInputQueueRegistry<typeof scope, AgentQueueState>(gateway,
    value => JSON.stringify([value.kind, value.resourceId, value.conversationId]), () => "original-request");
  return { registry, gateway };
}

it("retains unknown edits through detach and reattachment; reload never acknowledges an edit", async () => {
  const { registry, gateway } = setup();
  let fail!: (reason: unknown) => void;
  gateway.edit.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }))
    .mockRejectedValueOnce({ code: "closed" }).mockResolvedValue({ ...empty, revision: 1 });
  const first = registry.acquire(scope)!, acknowledge = vi.fn();
  expect(registry.hasPending()).toBe(false);
  await first.controller.reload();
  const pending = first.controller.edit({ type: "add", inputId: "input", text: "original" }, acknowledge);
  expect(registry.hasPending()).toBe(true);
  first.release(); fail(new Error("lost reply")); await pending;
  expect(registry.hasPending()).toBe(true);
  const second = registry.acquire({ ...scope })!;
  expect(second.controller).toBe(first.controller);
  gateway.read.mockResolvedValue({ ...empty, revision: 9 }); await second.controller.reload();
  expect(second.controller.getSnapshot().uncertain).toBe(true);
  expect(acknowledge).not.toHaveBeenCalled();
  expect(await second.controller.edit({ type: "pause" })).toBe(false);
  await second.controller.retry(); expect(acknowledge).toHaveBeenCalledOnce();
  expect(gateway.edit.mock.calls[0]).toEqual(gateway.edit.mock.calls[2]);
  expect(second.controller.getSnapshot().queue?.revision).toBe(9);
  expect(await second.controller.retry()).toBe(false);
  expect(registry.hasPending()).toBe(false);
  second.release(); const third = registry.acquire(scope)!;
  expect(third.controller).not.toBe(first.controller); third.release(); registry.dispose();
});

it("keeps reorder identity and order despite mutation by a caller or transport", async () => {
  const { registry, gateway } = setup();
  const lease = registry.acquire(scope)!;
  await lease.controller.reload();
  gateway.edit.mockImplementationOnce(async request => {
    request.edit.inputIds.reverse(); request.expectedRevision = 99;
    throw new Error("unknown");
  }).mockResolvedValue(empty);
  const ids = ["one", "two"];
  await lease.controller.edit({ type: "reorder", inputIds: ids });
  ids.reverse(); lease.release();
  const attached = registry.acquire(scope)!; await attached.controller.retry();
  expect(gateway.edit.mock.calls[1]?.[0]).toMatchObject({ expectedRevision: 0, requestId: "original-request", edit: { inputIds: ["one", "two"] } });
  attached.release(); registry.dispose();
});

it.each([true, false])("settled detached operation releases its owner (accepted=%s)", async accepted => {
  const { registry, gateway } = setup();
  let resolve!: (value: AgentQueueState) => void, reject!: (error: unknown) => void;
  gateway.edit.mockImplementation(() => new Promise((done, fail) => { resolve = done; reject = fail; }));
  const lease = registry.acquire(scope)!, acknowledge = vi.fn(); await lease.controller.reload();
  const pending = lease.controller.edit({ type: "pause" }, acknowledge); lease.release();
  if (accepted) resolve({ ...empty, revision: 1, paused: true }); else reject({ code: "conflict" });
  expect(await pending).toBe(accepted); expect(acknowledge).toHaveBeenCalledTimes(accepted ? 1 : 0);
  const next = registry.acquire(scope)!; expect(next.controller).not.toBe(lease.controller);
  next.release(); registry.dispose();
});

it("isolates typed hosts, conversations and application roots and shares concurrent leases", async () => {
  const { registry, gateway } = setup(), other = setup();
  gateway.edit.mockRejectedValue(new Error("unknown"));
  const first = registry.acquire(scope)!, second = registry.acquire(scope)!;
  expect(first.controller).toBe(second.controller); first.release(); first.release();
  await second.controller.reload(); await second.controller.edit({ type: "pause" });
  for (const changed of [{ ...scope, kind: "readingNote" }, { ...scope, resourceId: "two" }, { ...scope, conversationId: "other" }]) {
    const lease = registry.acquire(changed)!; expect(lease.controller.getSnapshot().uncertain).toBe(false); lease.release();
  }
  const isolated = other.registry.acquire(scope)!; expect(isolated.controller.getSnapshot().uncertain).toBe(false);
  isolated.release(); second.release(); registry.dispose(); other.registry.dispose();
});

it("deletion fences acceptance and root replay preserves pending state until actual shutdown", async () => {
  const { registry, gateway } = setup();
  let finish!: (value: AgentQueueState) => void;
  gateway.edit.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const release = registry.retain(), lease = registry.acquire(scope)!, acknowledge = vi.fn();
  await lease.controller.reload(); const pending = lease.controller.edit({ type: "pause" }, acknowledge);
  lease.release(); release(); const releaseAgain = registry.retain(); await Promise.resolve();
  const attached = registry.acquire(scope)!; expect(attached.controller).toBe(lease.controller); attached.release();
  registry.forgetConversation(scope.conversationId); finish(empty); expect(await pending).toBe(false);
  expect(acknowledge).not.toHaveBeenCalled(); expect(registry.acquire(scope)).toBeNull();
  const other = registry.acquire({ ...scope, conversationId: "survivor" })!;
  await other.controller.reload(); const last = other.controller.edit({ type: "pause" }, acknowledge);
  other.release(); releaseAgain(); await Promise.resolve(); finish(empty); expect(await last).toBe(false);
  expect(acknowledge).not.toHaveBeenCalled(); expect(registry.acquire({ ...scope, conversationId: "survivor" })).toBeNull();
});
it("retains an unissued command after reliable-save failure through detach without labeling it an unknown write", async () => {
  const {registry, gateway} = setup(); gateway.edit.mockResolvedValue({...empty, revision: 1, paused: true});
  const first = registry.acquire(scope)!; await first.controller.reload();
  const save = vi.fn<() => Promise<void>>().mockRejectedValueOnce(new Error("quota")).mockResolvedValue(undefined);
  expect(await first.controller.edit({type: "pause"}, undefined, save)).toBe(false);
  expect(registry.hasPending()).toBe(true);
  expect(first.controller.getSnapshot()).toMatchObject({pending: true, uncertain: false}); first.release();
  const restored = registry.acquire(scope)!; expect(restored.controller).toBe(first.controller); expect(gateway.edit).not.toHaveBeenCalled();
  expect(await restored.controller.retry()).toBe(true); expect(save).toHaveBeenCalledTimes(2); expect(gateway.edit).toHaveBeenCalledOnce();
  expect(registry.hasPending()).toBe(false);
  restored.release(); const later = registry.acquire(scope)!; expect(later.controller).not.toBe(first.controller); later.release(); registry.dispose();
});
