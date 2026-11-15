import { expect,it,vi } from "vitest";
import { decodeAgentWritingQueuePreview } from "../../packages/core/src/agent";
import { createAgentInputQueuePreviewGateway } from "../../packages/data/src/agent";
const id="11111111-1111-4111-8111-111111111111";
const other="22222222-2222-4222-8222-222222222222";
const scope={conversationId:id,manuscriptId:id};
const queue={schemaVersion:1,...scope,revision:2,paused:false,preparingInputId:other,inputs:[{inputId:other,text:"draft"}]};
const preview={schemaVersion:1,...scope,requestId:id,turnId:id,contextSnapshotId:id,input:{text:"draft",model:{providerId:"fixture",modelId:"test",revision:null},reasoningEffort:null,context:[]}};
const result={schemaVersion:1,inputId:other,preview,queue};
const request={inputId:other,expectedRevision:1,submission:{conversationId:id,requestId:id,text:"draft",context:{manuscriptId:id,files:[]}}};
it("routes confirmed queue starts separately and validates returned receipt",async()=>{
  const returned={schemaVersion:1,conversationId:id,requestId:id,turnId:id,alreadyStarted:false,outcome:null};
  const invoke=vi.fn().mockResolvedValue(returned);const gateway=createAgentInputQueuePreviewGateway(invoke);
  const start={inputId:other,expectedRevision:2,start:{...scope,requestId:id,contextSnapshotId:id,model:preview.input.model,mode:"deepSeekNonThinking" as const}};
  expect(await gateway.start(start)).toEqual(returned);
  expect(invoke).toHaveBeenCalledWith("agent_start_writing_queued_submission",{request:start});
  invoke.mockResolvedValue({...returned,requestId:other});
  await expect(gateway.start(start)).rejects.toThrow();
});
it("decodes matching preview and queue and rejects mixed snapshots",()=>{
  expect(decodeAgentWritingQueuePreview(result)).toEqual(result);
  for(const value of [{...result,schemaVersion:2},{...result,inputId:id},{...result,queue:{...queue,manuscriptId:other}},
    {...result,preview:{...preview,input:{...preview.input,text:"different"}}},{...result,credentials:"extra"}]) {
    expect(()=>decodeAgentWritingQueuePreview(value)).toThrow();
  }
});
it("validates request identity and revision and never automatically retries",async()=>{
  const invoke=vi.fn().mockResolvedValue(result);const gateway=createAgentInputQueuePreviewGateway(invoke);
  expect(await gateway.prepare(request)).toEqual(result);
  expect(invoke).toHaveBeenCalledWith("agent_prepare_writing_queue_preview",{request:{...request,submission:{...request.submission,
    userInput:[],resources:[],retrieval:null,model:null,sessionConfig:null,turnConfig:null}}});
  invoke.mockResolvedValue({...result,queue:{...queue,revision:8}});
  await expect(gateway.prepare(request)).rejects.toThrow();
  invoke.mockRejectedValue({code:"queue",reason:{code:"conflict"}});
  await expect(gateway.prepare(request)).rejects.toEqual({code:"queue",reason:{code:"conflict"}});
  expect(invoke).toHaveBeenCalledTimes(3);
});
it("cancellation must retain the original head and return a paused unlocked queue",async()=>{
  const cancel={...scope,inputId:other,requestId:id,previewRequestId:id,expectedRevision:2};
  const returned={...queue,revision:3,paused:true,preparingInputId:null};
  const invoke=vi.fn().mockResolvedValue(returned);const gateway=createAgentInputQueuePreviewGateway(invoke);
  expect(await gateway.cancel(cancel)).toEqual(returned);
  expect(invoke).toHaveBeenCalledWith("agent_cancel_writing_queue_preview",{request:cancel});
  for(const change of [{paused:false},{inputs:[]},{revision:4},{conversationId:other}]) {
    invoke.mockResolvedValue({...returned,...change});
    await expect(gateway.cancel(cancel)).rejects.toThrow();
  }
});
it("recovers only a scoped pending preview and distinguishes absence from invalid responses", async () => {
  const invoke = vi.fn().mockResolvedValue(result); const gateway = createAgentInputQueuePreviewGateway(invoke);
  expect(await gateway.recover(scope)).toEqual(result);
  expect(invoke).toHaveBeenCalledWith("agent_read_pending_writing_queue_preview", { request: scope });
  invoke.mockResolvedValue(null); expect(await gateway.recover(scope)).toBeNull();
  invoke.mockResolvedValue({ ...result, queue: { ...queue, conversationId: other }, preview: { ...preview, conversationId: other } });
  await expect(gateway.recover(scope)).rejects.toThrow();
  invoke.mockResolvedValue(undefined); await expect(gateway.recover(scope)).rejects.toThrow();
  const count = invoke.mock.calls.length;
  await expect(gateway.recover({ ...scope, conversationId: "invalid" })).rejects.toThrow();
  expect(invoke).toHaveBeenCalledTimes(count);
});
