import {expect,it,vi} from "vitest";
import {type AgentWritingStartRequest,type AgentCompactionStartRequest} from "@research-assistant/core/agent";
import {createAgentSubmissionGateway} from "./submission";
import {createAgentCompactionGateway} from "./compaction";
const id=(n:number)=>`abcdef00-1234-5678-abcd-${String(n).padStart(12,"0")}`;
const ordinary=():AgentWritingStartRequest=>({conversationId:id(1),manuscriptId:id(2),requestId:id(3),contextSnapshotId:id(4),
  model:{providerId:"retired-provider",modelId:"retired-model",revision:null},mode:"chatGptDefault"});
const manual=():AgentCompactionStartRequest=>({conversationId:id(1),requestId:id(3),contextSnapshotId:id(4),model:ordinary().model,
  expectedRevision:0,host:{kind:"manuscript",manuscriptId:id(2)}});
const result=()=>({schemaVersion:1,conversationId:id(1),requestId:id(3),turnId:id(5),alreadyStarted:true,outcome:"completed"});

it.each([false,true])("uses only the readonly start RPC and freezes original complete input, compact=%s",async compact=>{
  const intent=compact?manual():ordinary(),response={schemaVersion:1,intent:structuredClone(intent),status:{type:"started",result:result()}};
  const invoke=vi.fn(async (_command:string,_args:Record<string,unknown>)=>response);
  const gateway=compact?createAgentCompactionGateway(invoke):createAgentSubmissionGateway(invoke);
  const pending=gateway.startStatus(intent as AgentWritingStartRequest & AgentCompactionStartRequest);
  (intent as {requestId:string}).requestId=id(9);(intent.model as {modelId:string}).modelId="changed";
  expect(await pending).toEqual(response);
  expect(invoke).toHaveBeenCalledExactlyOnceWith(compact?"agent_read_writing_compaction_start_status":"agent_read_writing_start_status",{request:response.intent});
});
it.each([false,true])("rejects a foreign complete echoed intent even for internally valid NotFound, compact=%s",async compact=>{
  const intent=compact?manual():ordinary();
  const changed=[{...intent,conversationId:id(9)},{...intent,requestId:id(9)},{...intent,contextSnapshotId:id(9)},
    {...intent,model:{...intent.model,revision:"other"}},compact?{...manual(),expectedRevision:1}:{...ordinary(),mode:"deepSeekNonThinking"}];
  for(const echo of changed){const invoke=vi.fn(async()=>({schemaVersion:1,intent:echo,status:{type:"notFound"}}));
    const gateway=compact?createAgentCompactionGateway(invoke):createAgentSubmissionGateway(invoke);
    await expect(gateway.startStatus(intent as AgentWritingStartRequest & AgentCompactionStartRequest)).rejects.toThrow();expect(invoke).toHaveBeenCalledOnce();}
});
it.each([false,true])("propagates the original native error without preparing, starting, or retrying, compact=%s",async compact=>{
  const cause={code:"recoveryRequired",reason:{operationId:id(3),phase:"writing-start-status",safeCause:"sql_unavailable"}};
  const invoke=vi.fn(async()=>{throw cause;}),gateway=compact?createAgentCompactionGateway(invoke):createAgentSubmissionGateway(invoke);
  await expect(gateway.startStatus((compact?manual():ordinary()) as AgentWritingStartRequest & AgentCompactionStartRequest)).rejects.toBe(cause);
  expect(invoke).toHaveBeenCalledOnce();
});
it("normalizes Native UUID and absent revision spellings without changing current provider settings",async()=>{
  const request=ordinary(),echo={...request,conversationId:`urn:uuid:${id(1).toUpperCase()}`,manuscriptId:`{${id(2).toUpperCase()}}`,
    model:{providerId:request.model.providerId,modelId:request.model.modelId}};
  const invoke=vi.fn(async()=>({schemaVersion:1,intent:echo,status:{type:"notFound"}}));
  expect(await createAgentSubmissionGateway(invoke).startStatus(request)).toEqual({schemaVersion:1,intent:request,status:{type:"notFound"}});
});
it("rejects a non-Manuscript manual observation before invoking Native",async()=>{
  const invoke=vi.fn(async()=>null);
  await expect(createAgentCompactionGateway(invoke).startStatus({...manual(),host:{kind:"note",pageId:id(2)}})).rejects.toThrow();
  expect(invoke).not.toHaveBeenCalled();
});
