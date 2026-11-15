import { expect, it, vi } from "vitest";
import { AgentInputQueueController } from "../../packages/data/src/agent";
import type { AgentWritingQueueResponse } from "../../packages/core/src/agent";
const scope = { conversationId: "11111111-1111-4111-8111-111111111111", manuscriptId: "22222222-2222-4222-8222-222222222222" };
const initial: AgentWritingQueueResponse = { ...scope, schemaVersion: 1, revision: 0, paused: false, preparingInputId: null, inputs: [] };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }

it("retains exact uncertain request across reload and prevents duplicate edits", async () => {
  const gateway = { read: vi.fn().mockResolvedValue(initial), edit: vi.fn().mockRejectedValue(new Error("lost reply")) };
  const id = vi.fn(() => "request");
  const controller = new AgentInputQueueController(gateway, scope, id);
  await controller.reload();
  expect(await controller.edit({ type: "pause" })).toBe(false);
  const request = gateway.edit.mock.calls[0]?.[0];
  expect(controller.getSnapshot().uncertain).toBe(true);
  gateway.read.mockResolvedValue({ ...initial, revision: 3, paused: false });
  await controller.reload();
  expect(controller.getSnapshot().uncertain).toBe(true);
  expect(await controller.edit({ type: "resume" })).toBe(false);
  gateway.edit.mockResolvedValue({ ...initial, revision: 1, paused: true });
  expect(await controller.retry()).toBe(true);
  expect(gateway.edit.mock.calls[1]?.[0]).toEqual(request);
  expect(id).toHaveBeenCalledTimes(1);
  expect(controller.getSnapshot().queue?.revision).toBe(3);
  expect(controller.getSnapshot().uncertain).toBe(false);
});
it("fences stale reads and preserves synchronous write exclusion", async () => {
  const old = deferred<AgentWritingQueueResponse>();
  const writing = deferred<AgentWritingQueueResponse>();
  const gateway = { read: vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue(initial), edit: vi.fn().mockReturnValue(writing.promise) };
  const controller = new AgentInputQueueController(gateway, scope, () => "request");
  const reading = controller.reload();
  await controller.reload();
  const change = controller.edit({ type: "pause" });
  expect(await controller.edit({ type: "resume" })).toBe(false);
  old.resolve({ ...initial, revision: 99 });
  // A stale read joins the post-edit refresh; it cannot finish before the write.
  writing.resolve({ ...initial, revision: 1, paused: true }); await change; await reading;
  expect(controller.getSnapshot().queue?.revision).toBe(1);
});
it("explicit conflicts allow refresh and new requests without automatic replay", async () => {
  const gateway = { read: vi.fn().mockResolvedValue(initial), edit: vi.fn().mockRejectedValue({ code: "conflict" }) };
  const controller = new AgentInputQueueController(gateway, scope, () => "request");
  await controller.reload(); await controller.edit({ type: "pause" });
  expect(controller.getSnapshot().uncertain).toBe(false);
  expect(await controller.retry()).toBe(false);
  expect(gateway.edit).toHaveBeenCalledTimes(1);
});
it("dispose prevents late publication and future writes", async () => {
  const result = deferred<AgentWritingQueueResponse>();
  const gateway = { read: vi.fn().mockReturnValue(result.promise), edit: vi.fn() };
  const controller = new AgentInputQueueController(gateway, scope, () => "request");
  const listener = vi.fn(); controller.subscribe(listener);
  const reading = controller.reload(); controller.dispose(); listener.mockClear();
  result.resolve(initial); await reading;
  expect(listener).not.toHaveBeenCalled();
  expect(await controller.edit({ type: "pause" })).toBe(false);
});
it("a closed retry does not erase an earlier unknown commit outcome", async () => {
  const gateway = { read: vi.fn().mockResolvedValue(initial), edit: vi.fn().mockRejectedValueOnce(new Error("lost reply")).mockRejectedValue({ code: "closed" }) };
  const controller = new AgentInputQueueController(gateway, scope, () => "request");
  await controller.reload(); await controller.edit({ type: "pause" });
  await controller.retry();
  expect(controller.getSnapshot().uncertain).toBe(true);
  expect(await controller.edit({ type: "resume" })).toBe(false);
  expect(gateway.edit.mock.calls[0]?.[0]).toEqual(gateway.edit.mock.calls[1]?.[0]);
});
it("captures a typed note scope and retains its exact edit through reload, rejection and retry",async()=>{
  const noteScope={conversationId:scope.conversationId,scope:{kind:"readingNote" as const,resourceId:scope.manuscriptId}};
  const state={schemaVersion:1 as const,...structuredClone(noteScope),revision:0,paused:false,preparingInputId:null,inputs:[]};
  const gateway={read:vi.fn().mockResolvedValue(state),edit:vi.fn().mockRejectedValueOnce(new Error("lost reply")).mockRejectedValueOnce({code:"closed"}).mockRejectedValueOnce({code:"closed"}).mockResolvedValue({...state,revision:1,paused:true})};
  const controller=new AgentInputQueueController(gateway,noteScope,()=>"request");
  noteScope.scope.resourceId=scope.conversationId;
  await controller.reload();await controller.edit({type:"pause"});
  expect(gateway.edit.mock.calls[0]?.[0].scope.resourceId).toBe(scope.manuscriptId);
  gateway.read.mockResolvedValue({...state,revision:5});await controller.reload();await controller.retry();
  expect(controller.getSnapshot().uncertain).toBe(true);expect(await controller.edit({type:"resume"})).toBe(false);
  await controller.retry();
  expect(gateway.edit.mock.calls[0]).toEqual(gateway.edit.mock.calls[3]);
  expect(controller.getSnapshot().queue?.revision).toBe(5);expect(controller.getSnapshot().uncertain).toBe(false);
});
