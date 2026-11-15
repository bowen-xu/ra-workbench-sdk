import {afterEach, expect, it, vi} from "vitest";
import type {AgentQueueCommand, AgentQueueState} from "@research-assistant/core/agent";
import {AgentInputQueueController} from "./inputQueueController";

const scope = {conversationId: "conversation", manuscriptId: "manuscript"};
type Request = typeof scope & AgentQueueCommand;
const initial: AgentQueueState = {schemaVersion: 1, conversationId: scope.conversationId,
  revision: 4, paused: true, preparingInputId: null, inputs: []};
const after = {...initial, revision: 5, paused: false};
const add = {type: "add" as const, inputId: "input", text: "keep", userInput: []};

afterEach(() => vi.useRealTimers());

it("checks admission after its synchronous editing publication", async () => {
  let disabled = false;
  const write = vi.fn(async (_request: Request) => after);
  const owner = new AgentInputQueueController({read: async () => initial, edit: write}, scope, () => "request");
  await owner.reload(); const unsubscribe = owner.subscribe(() => {if (owner.getSnapshot().editing) disabled = true;});
  expect(await owner.edit(add, undefined, undefined, undefined, () => disabled)).toBe(false);
  expect(write).not.toHaveBeenCalled(); expect(owner.getSnapshot().error).toContain("requestId=request");
  unsubscribe(); owner.dispose();
});

it.each(["owner", "beforeSend"] as const)("retires an unissued edit after %s persistence without acknowledging its draft", async stage => {
  let disabled = false, release!: () => void;
  const wait = vi.fn(() => new Promise<void>(resolve => {release = resolve;}));
  const gateway = {read: vi.fn(async () => initial), edit: vi.fn(async (_request: Request) => after)};
  const owner = new AgentInputQueueController(gateway, scope, () => "request", stage === "owner" ? () => wait : undefined);
  const acknowledge = vi.fn(); await owner.reload();
  const work = owner.edit(add, acknowledge, stage === "beforeSend" ? wait : undefined, undefined, () => disabled);
  expect(wait).toHaveBeenCalledOnce(); disabled = true; release();
  expect(await work).toBe(false); expect(gateway.edit).not.toHaveBeenCalled(); expect(acknowledge).not.toHaveBeenCalled();
  expect(owner.getPendingRequest()).toBeNull(); expect(owner.getSnapshot()).toMatchObject({pending: false, uncertain: false, editing: false});
  expect(owner.getSnapshot().error).toMatch(/^WRITING_RUNTIME_UNAVAILABLE：/u);
  // The caller can retain its draft and later perform original accepted cleanup.
  wait.mockResolvedValue(undefined);
  expect(await owner.edit({type: "pause"})).toBe(true); owner.dispose();
});

it("can retire a warm failed-save command without rerunning its save or trapping the owner", async () => {
  let disabled = false;
  const save = vi.fn(async () => {throw Error("quota");});
  const gateway = {read: vi.fn(async () => initial), edit: vi.fn(async (_request: Request) => after)};
  const owner = new AgentInputQueueController(gateway, scope, () => "request"), acknowledge = vi.fn();
  await owner.reload(); expect(await owner.edit(add, acknowledge, save, undefined, () => disabled)).toBe(false);
  expect(owner.getPendingRequest()).not.toBeNull(); disabled = true;
  expect(await owner.retry()).toBe(false); expect(save).toHaveBeenCalledOnce();
  expect(gateway.edit).not.toHaveBeenCalled(); expect(acknowledge).not.toHaveBeenCalled();
  expect(owner.getPendingRequest()).toBeNull(); owner.dispose();
});

it("replays an already attempted command unchanged and acknowledges it while admission is closed", async () => {
  vi.useFakeTimers(); let disabled = false;
  const write = vi.fn(async (_request: Request) => after).mockImplementationOnce(async () => {disabled = true; throw Error("lost reply");});
  const owner = new AgentInputQueueController({read: async () => initial, edit: write}, scope, () => "original");
  const acknowledge = vi.fn(); await owner.reload(); const work = owner.edit(add, acknowledge, undefined, undefined, () => disabled);
  await vi.runAllTimersAsync(); expect(await work).toBe(true);
  expect(write).toHaveBeenCalledTimes(2); expect(write.mock.calls[1]).toEqual(write.mock.calls[0]);
  expect(acknowledge).toHaveBeenCalledOnce(); owner.dispose();
});

it("keeps cold saved commands conservative instead of giving them fresh local retirement", async () => {
  const write = vi.fn(async (_request: Request) => after), acknowledge = vi.fn();
  const owner = new AgentInputQueueController({read: async () => initial, edit: write}, scope, () => "unused");
  const saved: Request = {...scope, requestId: "saved", expectedRevision: 4, edit: add};
  expect(owner.restorePending(saved, acknowledge)).toBe(true);
  expect(owner.getSnapshot().uncertain).toBe(true); expect(await owner.retry()).toBe(true);
  expect(write).toHaveBeenCalledExactlyOnceWith(saved); expect(acknowledge).toHaveBeenCalledOnce(); owner.dispose();
});

it("does not convert a warm unissued command to attempted when a locator reattaches the same identity", async () => {
  let disabled = false;
  const write = vi.fn(async (_request: Request) => after), acknowledge = vi.fn();
  const owner = new AgentInputQueueController({read: async () => initial, edit: write}, scope, () => "saved");
  await owner.reload();
  expect(await owner.edit(add, acknowledge, async () => {throw Error("quota");}, undefined, () => disabled)).toBe(false);
  const saved = owner.getPendingRequest()!, reattachedSave = vi.fn(async () => {});
  expect(owner.restorePending(saved, undefined, reattachedSave)).toBe(true); disabled = true;
  expect(await owner.retry()).toBe(false); expect(write).not.toHaveBeenCalled(); expect(reattachedSave).not.toHaveBeenCalled();
  expect(acknowledge).not.toHaveBeenCalled(); expect(owner.getPendingRequest()).toBeNull(); owner.dispose();
});

it.each(["read", "owner"] as const)("does not dispatch a fresh rebased identity after its %s wait closes admission", async stage => {
  let disabled = false, release!: () => void;
  const hold = () => new Promise<void>(resolve => {release = resolve;});
  const read = vi.fn(async () => initial).mockResolvedValueOnce(initial).mockImplementationOnce(async () => {
    if (stage === "read") await hold(); return {...initial, revision: 5};
  });
  const prepare = vi.fn(async (id: string) => {if (stage === "owner" && id === "rebased") await hold();});
  const write = vi.fn(async (_request: Request) => after).mockRejectedValueOnce({code: "conflict"});
  const ids = ["original", "rebased"], owner = new AgentInputQueueController({read, edit: write}, scope, () => ids.shift()!, () => prepare);
  const acknowledge = vi.fn(); await owner.reload();
  const work = owner.edit(add, acknowledge, undefined, undefined, () => disabled);
  await vi.waitFor(() => expect(release).toBeTypeOf("function")); disabled = true; release();
  expect(await work).toBe(false); expect(write).toHaveBeenCalledOnce(); expect(acknowledge).not.toHaveBeenCalled();
  expect(owner.getPendingRequest()).toBeNull(); expect(owner.getSnapshot().uncertain).toBe(false); owner.dispose();
});
