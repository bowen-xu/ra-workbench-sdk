import {afterEach, expect, it, vi} from "vitest";
import type {AgentQueueCommand, AgentQueueEdit, AgentQueueState} from "@research-assistant/core/agent";
import {AgentInputQueueController} from "./inputQueueController";

const scope = {conversationId: "conversation", manuscriptId: "manuscript", kind: "writing"};
type Request = typeof scope & AgentQueueCommand;
const empty: AgentQueueState = {schemaVersion: 1, conversationId: scope.conversationId, revision: 4, paused: true, preparingInputId: null, inputs: []};
const resumed = {...empty, revision: 5, paused: false};
const command = (): Request => ({...scope, requestId: "original-operation", expectedRevision: 4, edit: {type: "resume"}});
function setup() {
  const gateway = {read: vi.fn(async () => empty), edit: vi.fn(async (_request: Request) => resumed)};
  const nextId = vi.fn(() => "original-operation"), controller = new AgentInputQueueController(gateway, scope, nextId);
  return {gateway, nextId, controller};
}
afterEach(() => vi.useRealTimers());

it("waits for the complete command to be reliably saved before any gateway write", async () => {
  const f = setup(), acknowledge = vi.fn(); await f.controller.reload();
  let finish!: () => void; const save = vi.fn(async (request: Request) => {
    expect(request).toEqual(command()); const mutable = request as {edit: AgentQueueEdit; expectedRevision: number}; mutable.edit = {type: "pause"}; mutable.expectedRevision = 99;
    await new Promise<void>(resolve => {finish = resolve;});
  });
  const work = f.controller.edit({type: "resume"}, acknowledge, save);
  expect(f.gateway.edit).not.toHaveBeenCalled(); expect(f.controller.getSnapshot()).toMatchObject({editing: true, pending: true, uncertain: false});
  expect(f.controller.getPendingRequest()).toEqual(command());
  const copy = f.controller.getPendingRequest()! as {edit: AgentQueueEdit; requestId: string}; copy.edit = {type: "pause"}; copy.requestId = "caller changed";
  expect(f.controller.getPendingRequest()).toEqual(command()); finish(); expect(await work).toBe(true);
  expect(f.gateway.edit).toHaveBeenCalledExactlyOnceWith(command()); expect(save).toHaveBeenCalledOnce(); expect(acknowledge).toHaveBeenCalledOnce();
  expect(f.controller.getSnapshot()).toMatchObject({pending: false, uncertain: false}); expect(f.controller.getPendingRequest()).toBeNull();
});
it("a failed reliable save retains the unissued command and retries that same operation after saving", async () => {
  const f = setup(); await f.controller.reload();
  const save = vi.fn<(...args: [Request]) => Promise<void>>().mockRejectedValueOnce(new Error("quota")).mockResolvedValue(undefined);
  expect(await f.controller.edit({type: "resume"}, undefined, save)).toBe(false); expect(f.gateway.edit).not.toHaveBeenCalled();
  expect(f.controller.getSnapshot()).toMatchObject({pending: true, uncertain: false, editing: false}); expect(f.controller.getSnapshot().error).toContain("QUEUE_PERSISTENCE_FAILED");
  expect(await f.controller.edit({type: "pause"})).toBe(false); expect(await f.controller.retry()).toBe(true);
  expect(save.mock.calls.map(([request]) => request)).toEqual([command(), command()]); expect(f.gateway.edit).toHaveBeenCalledExactlyOnceWith(command()); expect(f.nextId).toHaveBeenCalledOnce();
});
it("disposal during reliable save prevents the later gateway write and acknowledgment", async () => {
  const f = setup(); await f.controller.reload(); let finish!: () => void; const acknowledge = vi.fn();
  const work = f.controller.edit({type: "resume"}, acknowledge, () => new Promise(resolve => {finish = resolve;}));
  f.controller.dispose(); finish(); expect(await work).toBe(false); expect(f.gateway.edit).not.toHaveBeenCalled(); expect(acknowledge).not.toHaveBeenCalled();
});
it("reopens by reserving exactly the saved scope/op/Q/edit without sending, and current reads do not acknowledge", async () => {
  const f = setup(), saved = command(), acknowledge = vi.fn(), save = vi.fn(async () => {});
  const reordered = {edit: saved.edit, expectedRevision: saved.expectedRevision, requestId: saved.requestId, kind: scope.kind,
    manuscriptId: scope.manuscriptId, conversationId: scope.conversationId};
  expect(f.controller.restorePending(reordered, acknowledge, save)).toBe(true); expect(f.gateway.edit).not.toHaveBeenCalled(); expect(f.nextId).not.toHaveBeenCalled();
  reordered.expectedRevision = 99; expect(f.controller.getPendingRequest()).toEqual(saved);
  f.gateway.read.mockResolvedValue({...empty, revision: 12}); await f.controller.reload(); expect(acknowledge).not.toHaveBeenCalled();
  expect(f.controller.getSnapshot()).toMatchObject({pending: true, uncertain: true, queue: {revision: 12}});
  expect(await f.controller.retry()).toBe(true); expect(save).toHaveBeenCalledExactlyOnceWith(saved); expect(f.gateway.edit).toHaveBeenCalledExactlyOnceWith(saved);
  expect(acknowledge).toHaveBeenCalledOnce(); expect(f.controller.getSnapshot().queue?.revision).toBe(12);
});
it("rejects every foreign scope field or extra scope dimension without replacing the reserved command", async () => {
  const f = setup();
  for (const patch of [{conversationId: "other"}, {manuscriptId: "other"}, {kind: "note"}, {resourceId: "extra"}])
    expect(f.controller.restorePending({...command(), ...patch})).toBe(false);
  expect(f.controller.getPendingRequest()).toBeNull(); expect(f.controller.restorePending(command())).toBe(true);
  for (const patch of [{requestId: "newer-operation"}, {expectedRevision: 8}, {edit: {type: "pause" as const}}])
    expect(f.controller.restorePending({...command(), ...patch})).toBe(false);
  expect(f.controller.getPendingRequest()).toEqual(command()); expect(f.gateway.edit).not.toHaveBeenCalled();
});
it("neither matching nor newer restoration may replace an in-flight reserved command", async () => {
  const f = setup(); await f.controller.reload(); let finish!: () => void;
  const work = f.controller.edit({type: "resume"}, undefined, () => new Promise(resolve => {finish = resolve;}));
  expect(f.controller.restorePending(command())).toBe(false); expect(f.controller.restorePending({...command(), requestId: "newer"})).toBe(false);
  expect(f.controller.getPendingRequest()).toEqual(command()); finish(); expect(await work).toBe(true); expect(f.gateway.edit).toHaveBeenCalledOnce();
});
it("reattaches the same known unissued command with a live save callback without inventing uncertainty", async () => {
  const f = setup(); await f.controller.reload(); const original = vi.fn(async () => {throw new Error("disposed locator owner");});
  await f.controller.edit({type: "resume"}, undefined, original);
  const liveSave = vi.fn(async () => {}); expect(f.controller.restorePending(command(), undefined, liveSave)).toBe(true);
  expect(f.controller.getSnapshot().uncertain).toBe(false); expect(await f.controller.retry()).toBe(true);
  expect(original).toHaveBeenCalledOnce(); expect(liveSave).toHaveBeenCalledExactlyOnceWith(command());
});
it("a successful save is reused across bounded transport retries of the same command", async () => {
  vi.useFakeTimers(); const f = setup(); await f.controller.reload(); const save = vi.fn(async () => {});
  f.gateway.edit.mockRejectedValueOnce(new Error("lost reply")); const work = f.controller.edit({type: "resume"}, undefined, save);
  await vi.advanceTimersByTimeAsync(300); expect(await work).toBe(true);
  expect(save).toHaveBeenCalledOnce(); expect(f.gateway.edit.mock.calls[0]).toEqual(f.gateway.edit.mock.calls[1]);
});
it("an old restored ambiguous command survives a subsequent definitive rejection and a later retry stays exact", async () => {
  const f = setup(), acknowledge = vi.fn(); f.gateway.edit.mockRejectedValueOnce({code: "conflict"});
  expect(f.controller.restorePending(command(), acknowledge)).toBe(true); expect(await f.controller.retry()).toBe(false);
  expect(f.controller.getSnapshot()).toMatchObject({pending: true, uncertain: true}); expect(f.controller.getPendingRequest()).toEqual(command());
  expect(acknowledge).not.toHaveBeenCalled(); expect(await f.controller.edit({type: "pause"})).toBe(false);
  expect(await f.controller.retry()).toBe(true); expect(f.gateway.edit.mock.calls[0]).toEqual(f.gateway.edit.mock.calls[1]); expect(acknowledge).toHaveBeenCalledOnce();
});
it("an original Resume receipt cannot overwrite a later current Pause or turn it into a new Resume", async () => {
  const f = setup(), acknowledge = vi.fn(); expect(f.controller.restorePending(command(), acknowledge)).toBe(true);
  const laterPause = {...empty, revision: 17, paused: true}; f.gateway.read.mockResolvedValue(laterPause); await f.controller.reload();
  expect(await f.controller.retry()).toBe(true); expect(f.controller.getSnapshot().queue).toEqual(laterPause);
  expect(f.gateway.edit).toHaveBeenCalledExactlyOnceWith(command()); expect(acknowledge).toHaveBeenCalledOnce(); expect(f.nextId).not.toHaveBeenCalled();
});
