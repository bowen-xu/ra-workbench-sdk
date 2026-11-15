import { expect, it, vi } from "vitest";
import type { AgentQueueState } from "@research-assistant/core/agent";
import { AgentInputQueueController } from "./inputQueueController";

const scope={conversationId:"conversation"};
const queue:AgentQueueState={schemaVersion:1,conversationId:"conversation",revision:4,paused:false,preparingInputId:null,inputs:[]};
it("advances the read sequence only for current, same-scope non-stale snapshots",async()=>{
  const read=vi.fn<()=>Promise<AgentQueueState>>().mockResolvedValue(queue);
  const controller=new AgentInputQueueController({read,edit:async()=>queue},scope,()=>"request");
  await controller.reload();expect(controller.getSnapshot().readSequence).toBe(1);
  read.mockResolvedValueOnce({...queue,revision:3});await controller.reload();
  expect(controller.getSnapshot().readSequence).toBe(1);expect(controller.getSnapshot().queue?.revision).toBe(4);
  read.mockResolvedValueOnce({...queue,conversationId:"other"});await controller.reload();
  expect(controller.getSnapshot().readSequence).toBe(1);expect(controller.getSnapshot().error).toBe("读取队列失败，请重试。");
  let resolveOld!:(value:AgentQueueState)=>void;
  read.mockImplementationOnce(()=>new Promise(resolve=>{resolveOld=resolve;})).mockResolvedValueOnce({...queue,revision:5});
  const older=controller.reload();await controller.reload();resolveOld({...queue,revision:6});await older;
  expect(controller.getSnapshot().readSequence).toBe(2);expect(controller.getSnapshot().queue?.revision).toBe(5);
  controller.dispose();
});
