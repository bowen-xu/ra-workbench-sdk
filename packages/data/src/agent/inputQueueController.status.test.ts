import {afterEach, expect, it, vi} from "vitest";
import {agentQueueEditIntentFromRequest, type AgentQueueEditStatusResponse,
  type AgentWritingQueueEditRequest, type AgentWritingQueueResponse} from "@research-assistant/core/agent";
import {AgentInputQueueController} from "./inputQueueController";

const scope = {conversationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", manuscriptId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"};
const requestId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc", epoch = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const inputId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", foreign = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const empty: AgentWritingQueueResponse = {schemaVersion: 1, ...scope, revision: 0, paused: false, preparingInputId: null, inputs: []};
const edit = {type: "add" as const, inputId, text: "原意图 e\u0301\n"};
const original = (): AgentWritingQueueEditRequest => ({...scope, requestId, expectedRevision: 0, edit});
function response(): AgentQueueEditStatusResponse {
  return {schemaVersion: 1, intent: agentQueueEditIntentFromRequest(original()), status: {
    type: "committed", proof: {schemaVersion: 1, operationId: requestId, conversationId: scope.conversationId,
      family: "agent.input_queue.edit", epoch, sqlFence: "0", replayed: true, result: null},
    queue: {schemaVersion: 1, conversationId: scope.conversationId, revision: 1, paused: false,
      preparingInputId: null, inputs: [{inputId, text: edit.text}]},
  }};
}
function setup() {
  const gateway = {read: vi.fn<() => Promise<AgentWritingQueueResponse>>().mockResolvedValue(empty),
    edit: vi.fn<(request: AgentWritingQueueEditRequest) => Promise<AgentWritingQueueResponse>>().mockRejectedValue({code: "closed"}),
    inspectEdit: vi.fn<(request: AgentWritingQueueEditRequest) => Promise<AgentQueueEditStatusResponse>>().mockResolvedValue(response())};
  const nextId = vi.fn(() => requestId), controller = new AgentInputQueueController(gateway, scope, nextId);
  return {gateway, nextId, controller};
}
afterEach(() => vi.useRealTimers());

it("signs off an exact lost-reply proof once and reads current Q without installing historical Q", async () => {
  const f = setup(), acknowledge = vi.fn(); await f.controller.reload();
  const later = {...empty, revision: 7, paused: true}; f.gateway.read.mockResolvedValue(later);
  f.gateway.edit.mockRejectedValueOnce(new Error("lost ACK"));
  expect(await f.controller.edit(edit, acknowledge)).toBe(true);
  expect(f.gateway.edit).toHaveBeenCalledExactlyOnceWith(original());
  expect(f.gateway.inspectEdit).toHaveBeenCalledExactlyOnceWith(original());
  expect(acknowledge).toHaveBeenCalledOnce(); expect(f.nextId).toHaveBeenCalledOnce();
  expect(f.controller.getSnapshot()).toMatchObject({queue: later, pending: false, uncertain: false, editing: false});
  expect(f.controller.getPendingRequest()).toBeNull(); expect(await f.controller.retry()).toBe(false);
});

it("checks a restored original only after reliable persistence, without another edit or ID", async () => {
  const f = setup(), acknowledge = vi.fn(); await f.controller.reload();
  let saved = false;
  const persist = vi.fn(async (request: AgentWritingQueueEditRequest) => {expect(request).toEqual(original()); saved = true;});
  f.gateway.inspectEdit.mockImplementation(async () => {expect(saved).toBe(true); return response();});
  expect(f.controller.restorePending(original(), acknowledge, persist)).toBe(true);
  expect(await f.controller.retry()).toBe(true);
  expect(persist).toHaveBeenCalledOnce(); expect(f.gateway.edit).not.toHaveBeenCalled(); expect(f.nextId).not.toHaveBeenCalled();
  expect(acknowledge).toHaveBeenCalledOnce();
});

it("keeps a proven acknowledgment when reading current Q fails", async () => {
  const f = setup(), acknowledge = vi.fn(); await f.controller.reload();
  f.controller.restorePending(original(), acknowledge); f.gateway.read.mockRejectedValue(new Error("current binding closed"));
  expect(await f.controller.retry()).toBe(true);
  expect(f.gateway.edit).not.toHaveBeenCalled(); expect(acknowledge).toHaveBeenCalledOnce();
  expect(f.controller.getSnapshot()).toMatchObject({queue: empty, pending: false, uncertain: false, editing: false, loading: false});
  expect(f.controller.getSnapshot().error).toContain("读取队列失败");
});

it.each(["notFound", "unconfirmed", "deleted"] as const)("%s never signs off or discards the original ambiguous request", async type => {
  const f = setup(), acknowledge = vi.fn(), known = response();
  const detail = {operationId: requestId, epoch: null, sqlFence: null, phase: "queue-edit-status",
    sqliteCode: null, sqliteExtendedCode: null, safeCause: "legacy_queue_edit_receipt_without_sql_proof"};
  if (known.status.type !== "committed") throw new Error("fixture");
  f.gateway.inspectEdit.mockResolvedValue({...known, status: type === "deleted"
    ? {type, proof: known.status.proof, detail} : type === "unconfirmed" ? {type, detail} : {type}});
  f.controller.restorePending(original(), acknowledge);
  expect(await f.controller.retry()).toBe(false);
  expect(f.controller.getPendingRequest()).toEqual(original()); expect(acknowledge).not.toHaveBeenCalled();
  expect(f.controller.getSnapshot()).toMatchObject({pending: true, uncertain: true});
  expect(f.gateway.edit).toHaveBeenCalledExactlyOnceWith(original()); expect(f.nextId).not.toHaveBeenCalled();
});

it.each(["echo", "proof", "queue"])("rejects a foreign %s even from an inspection-capable gateway", async part => {
  const f = setup(), acknowledge = vi.fn(), known = response();
  if (known.status.type !== "committed") throw new Error("fixture");
  const changed = part === "echo" ? {...known, intent: {...known.intent, scope: {kind: "manuscript" as const, manuscriptId: foreign}}}
    : part === "proof" ? {...known, status: {...known.status, proof: {...known.status.proof, operationId: foreign}}}
      : {...known, status: {...known.status, queue: {...known.status.queue, revision: 99}}};
  f.gateway.inspectEdit.mockResolvedValue(changed); f.controller.restorePending(original(), acknowledge);
  expect(await f.controller.retry()).toBe(false); expect(acknowledge).not.toHaveBeenCalled();
  expect(f.controller.getPendingRequest()).toEqual(original()); expect(f.gateway.edit).toHaveBeenCalledExactlyOnceWith(original());
});

it("a first definite rejection neither inspects nor acknowledges", async () => {
  const f = setup(), acknowledge = vi.fn(); await f.controller.reload();
  expect(await f.controller.edit(edit, acknowledge)).toBe(false);
  expect(f.gateway.inspectEdit).not.toHaveBeenCalled(); expect(acknowledge).not.toHaveBeenCalled();
  expect(f.controller.getSnapshot()).toMatchObject({pending: false, uncertain: false});
});

it("failed reliable persistence cannot inspect or write an unissued original", async () => {
  const f = setup(), acknowledge = vi.fn();
  f.controller.restorePending(original(), acknowledge, async () => {throw new Error("local intent not durable");});
  expect(await f.controller.retry()).toBe(false);
  expect(f.gateway.inspectEdit).not.toHaveBeenCalled(); expect(f.gateway.edit).not.toHaveBeenCalled(); expect(acknowledge).not.toHaveBeenCalled();
  expect(f.controller.getPendingRequest()).toEqual(original());
});

it("fences a late status after disposal and owns a copy of its request", async () => {
  const f = setup(), acknowledge = vi.fn(); let finish!: (value: AgentQueueEditStatusResponse) => void;
  f.gateway.inspectEdit.mockImplementation(request => {
    (request as {requestId: string}).requestId = foreign;
    return new Promise(resolve => {finish = resolve;});
  });
  f.controller.restorePending(original(), acknowledge); const retry = f.controller.retry();
  expect(f.controller.getPendingRequest()).toEqual(original()); f.controller.dispose(); finish(response());
  expect(await retry).toBe(false); expect(acknowledge).not.toHaveBeenCalled();
  expect(f.gateway.read).not.toHaveBeenCalled(); expect(f.gateway.edit).not.toHaveBeenCalled();
});
