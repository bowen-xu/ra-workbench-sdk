import { afterEach, expect, it, vi } from "vitest";
import type { AgentWritingQueueResponse } from "@research-assistant/core/agent";
import { createAgentInputQueueGateway } from "./inputQueue";
import { createAgentPaperQueueGateway } from "./paperQueue";
import { AgentInputQueueController } from "./inputQueueController";

const conversationId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",requestId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const manuscriptId="cccccccc-cccc-4ccc-8ccc-cccccccccccc",foreign="dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const scope={conversationId,manuscriptId};
const empty:AgentWritingQueueResponse={schemaVersion:1,...scope,revision:4,paused:false,preparingInputId:null,inputs:[]};
const edit={type:"add" as const,inputId:"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",text:"Original draft with its input",userInput:[{type:"text" as const,text:"Original draft with its input",textElements:[]}]};
const original={...scope,requestId,expectedRevision:4,edit};
const queuedInput={inputId:edit.inputId,text:edit.text,userInput:edit.userInput};
function storageFailure(operationId=requestId) {
  return {code:"QUEUE_STORAGE_FAILURE",...scope,requestId,operationId:requestId,scope:{kind:"manuscript",manuscriptId},
    reason:{code:"DATA_SQL_COMMIT_UNKNOWN",reason:{operationId,phase:"sql_commit",safeCause:"sql_commit_outcome_unknown",sqlFence:"42",
      sqliteCode:"SystemIoFailure",sqliteExtendedCode:778,sql:"select private data",raw:"Authorization: Bearer private-token"}}};
}
function setup() {
  const read=vi.fn(async()=>empty),write=vi.fn(async(_request:unknown)=>({...empty,revision:5,inputs:[queuedInput]}));
  const invoke=vi.fn(async(command:string,args?:Record<string,unknown>)=>{
    if(command==="agent_read_writing_input_queue")return read();
    if(command==="agent_edit_writing_input_queue")return write(args?.request);
    // This suite isolates storage-error presentation while status is unavailable.
    throw new Error("status transport unavailable");
  });
  const nextId=vi.fn(()=>requestId),controller=new AgentInputQueueController(createAgentInputQueueGateway(invoke),scope,nextId);
  return {read,write,invoke,nextId,controller};
}
afterEach(()=>vi.useRealTimers());

it("keeps the exact original edit and draft through three storage failures, then a later real receipt acknowledges once",async()=>{
  vi.useFakeTimers();const f=setup(),acknowledge=vi.fn();await f.controller.reload();
  f.write.mockRejectedValue(storageFailure());const work=f.controller.edit(edit,acknowledge);
  await vi.advanceTimersByTimeAsync(1200);expect(await work).toBe(false);
  expect(f.write).toHaveBeenCalledTimes(3);expect(f.write.mock.calls.map(([request])=>request)).toEqual([original,original,original]);
  const status=f.controller.getSnapshot();expect(status).toMatchObject({pending:true,uncertain:true,editing:false,retrying:false});
  for(const token of ["QUEUE_STORAGE_FAILURE","DATA_SQL_COMMIT_UNKNOWN",conversationId,requestId,manuscriptId,
    "sql_commit_outcome_unknown","sqlFence=42","SystemIoFailure","778","最近存储诊断","当前结果仍未确认"])expect(status.error).toContain(token);
  expect(status.error).not.toMatch(/select private|Bearer|private-token/u);expect(acknowledge).not.toHaveBeenCalled();
  expect(f.controller.getPendingRequest()).toEqual(original);
  f.read.mockResolvedValue({...empty,revision:12,paused:true});await f.controller.reload();
  expect(f.controller.getSnapshot().error).toBe(status.error);expect(acknowledge).not.toHaveBeenCalled();
  f.write.mockResolvedValue({...empty,revision:5,inputs:[queuedInput]});expect(await f.controller.retry()).toBe(true);
  expect(f.write).toHaveBeenLastCalledWith(original);expect(acknowledge).toHaveBeenCalledOnce();expect(f.nextId).toHaveBeenCalledOnce();
  expect(f.controller.getSnapshot()).toMatchObject({pending:false,uncertain:false,error:null,queue:{revision:12,paused:true}});
});

it("keeps the latest matched diagnosis within this attempt when a later closed reply cannot disprove the earlier unknown",async()=>{
  vi.useFakeTimers();const f=setup();await f.controller.reload();
  f.write.mockRejectedValueOnce(storageFailure()).mockRejectedValueOnce({code:"closed"});
  const work=f.controller.edit(edit);await vi.advanceTimersByTimeAsync(300);expect(await work).toBe(false);
  expect(f.write).toHaveBeenCalledTimes(2);expect(f.read).toHaveBeenCalledOnce();
  expect(f.controller.getSnapshot()).toMatchObject({pending:true,uncertain:true});
  expect(f.controller.getSnapshot().error).toContain("最近存储诊断（当前结果仍未确认）");
  expect(f.controller.getSnapshot().error).toContain("sql_commit_outcome_unknown");
  // A new explicit retry does not reuse diagnostic state from the previous call.
  expect(await f.controller.retry()).toBe(true);expect(f.controller.getSnapshot().error).toBeNull();
});

it("does not show a foreign inner operation or secret fields while preserving the original uncertain request",async()=>{
  vi.useFakeTimers();const f=setup(),acknowledge=vi.fn();await f.controller.reload();
  f.write.mockRejectedValue(storageFailure(foreign));const work=f.controller.edit(edit,acknowledge);
  await vi.advanceTimersByTimeAsync(1200);expect(await work).toBe(false);
  expect(f.controller.getSnapshot().error).toBe("队列暂时无法同步，消息已保留。");
  expect(f.controller.getSnapshot().error).not.toContain(foreign);expect(f.controller.getPendingRequest()).toEqual(original);
  expect(acknowledge).not.toHaveBeenCalled();expect(f.read).toHaveBeenCalledOnce();
});

it("preserves definitive lowercase rejection and refresh semantics without carrying diagnostics into a later operation",async()=>{
  const f=setup(),acknowledge=vi.fn();await f.controller.reload();f.write.mockRejectedValueOnce({code:"conflict"});
  expect(await f.controller.edit(edit,acknowledge)).toBe(false);
  expect(f.write).toHaveBeenCalledOnce();expect(f.read).toHaveBeenCalledTimes(2);expect(acknowledge).not.toHaveBeenCalled();
  expect(f.controller.getSnapshot()).toMatchObject({pending:false,uncertain:false,error:"队列操作未应用，消息已保留。"});
  expect(f.controller.getPendingRequest()).toBeNull();expect(await f.controller.edit(edit,acknowledge)).toBe(true);
  expect(f.controller.getSnapshot().error).toBeNull();expect(acknowledge).toHaveBeenCalledOnce();
});

it("binds a legacy paper ID without rendering its private title in queue diagnostics",async()=>{
  vi.useFakeTimers();const paperId=" 私有论文 ".repeat(40),paperScope={conversationId,paperId};
  const failure={...storageFailure(),scope:{kind:"paper",paperId}};
  const invoke=vi.fn(async(command:string)=>{
    if(command==="agent_read_paper_input_queue")return {schemaVersion:1,...paperScope,revision:4,paused:false,preparingInputId:null,inputs:[]};
    throw failure;
  });
  const controller=new AgentInputQueueController(createAgentPaperQueueGateway(invoke),paperScope,()=>requestId);
  await controller.reload();const work=controller.edit(edit);await vi.advanceTimersByTimeAsync(1200);expect(await work).toBe(false);
  expect(controller.getSnapshot().error).toContain("scope=paper");expect(controller.getSnapshot().error).toContain("QUEUE_STORAGE_FAILURE");
  expect(controller.getSnapshot().error).not.toContain(paperId);expect(controller.getSnapshot().error).not.toContain("私有论文");
  expect(controller.getPendingRequest()).toEqual({...paperScope,requestId,expectedRevision:4,edit});
});
