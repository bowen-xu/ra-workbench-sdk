import {expect, it, vi} from "vitest";
import type {AgentStartResponse} from "@research-assistant/core/agent";
import {ReviewedSubmissionController} from "./reviewedSubmissionController";
import {ReviewedSubmissionOwnerRegistry} from "./reviewedSubmissionOwner";

const receipt = {conversationId: "11111111-1111-4111-8111-111111111111", requestId: "22222222-2222-4222-8222-222222222222"};
const preview = {...receipt, turnId: "33333333-3333-4333-8333-333333333333"};
const admission: AgentStartResponse = {...preview, schemaVersion: 1, alreadyStarted: false, outcome: null};

function setup() {
  const gateway = {prepare: vi.fn(async () => preview), restore: vi.fn(async () => preview), start: vi.fn(async () => admission)};
  const turns = {interrupt: vi.fn(async () => ({schemaVersion: 1 as const, conversationId: receipt.conversationId,
    turnId: preview.turnId, cancellationRequested: true}))};
  const create = vi.fn(() => new ReviewedSubmissionController({conversationId: receipt.conversationId,
    decodeRequest: (value: typeof receipt) => structuredClone(value),
    decodeReceipt: () => ({...receipt}), receipt: (value: typeof receipt) => ({...value}),
  }, gateway, turns));
  const pending = vi.fn((controller: ReturnType<typeof create>) => {
    const state = controller.getSnapshot();
    return state.phase !== "idle" && state.outcome === null;
  });
  return {registry: new ReviewedSubmissionOwnerRegistry(pending), create, gateway, turns, pending};
}

it("queries the original predicate and retains a detached preview without side effects", async () => {
  const f = setup();
  expect(f.registry.hasPending()).toBe(false);
  const lease = f.registry.acquire("opaque owner key", f.create);
  const dispose = vi.spyOn(lease.controller, "dispose");
  expect(f.registry.hasPending()).toBe(false);
  await lease.controller.prepare(receipt); lease.release();
  const snapshot = lease.controller.getSnapshot();
  expect(f.registry.hasPending()).toBe(true);
  expect(f.registry.hasPending()).toBe(true);
  expect(lease.controller.getSnapshot()).toBe(snapshot);
  expect(f.pending).toHaveBeenLastCalledWith(lease.controller);
  expect(f.gateway.prepare).toHaveBeenCalledOnce();
  expect(f.gateway.restore).not.toHaveBeenCalled(); expect(f.gateway.start).not.toHaveBeenCalled();
  expect(f.turns.interrupt).not.toHaveBeenCalled(); expect(dispose).not.toHaveBeenCalled();
  const reattached = f.registry.acquire("opaque owner key", f.create);
  expect(reattached.controller).toBe(lease.controller); expect(f.create).toHaveBeenCalledOnce();
  expect(reattached.controller.dismiss()).toBe(true);
  expect(f.registry.hasPending()).toBe(false);
  reattached.release();
  expect(dispose).toHaveBeenCalledOnce(); expect(f.registry.peek("opaque owner key")).toBeUndefined();
  f.registry.resetForTests();
});

it("observes the original settlement and collection of an admitted detached owner", async () => {
  const f = setup(), lease = f.registry.acquire("not JSON", f.create);
  const dispose = vi.spyOn(lease.controller, "dispose");
  await lease.controller.prepare(receipt); await lease.controller.confirm("chatGptDefault");
  lease.release();
  expect(f.registry.hasPending()).toBe(true);
  expect(dispose).not.toHaveBeenCalled();
  lease.controller.observeOutcome(preview.turnId, "completed");
  expect(f.registry.hasPending()).toBe(false);
  expect(f.registry.peek("not JSON")).toBeUndefined(); expect(dispose).toHaveBeenCalledOnce();
  expect(f.gateway.start).toHaveBeenCalledOnce(); expect(f.turns.interrupt).not.toHaveBeenCalled();
  const next = f.registry.acquire("not JSON", f.create);
  expect(next.controller).not.toBe(lease.controller); expect(f.create).toHaveBeenCalledTimes(2);
  expect(f.registry.hasPending()).toBe(false);
  next.release(); f.registry.resetForTests();
});
