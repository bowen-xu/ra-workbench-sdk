import {expect, it} from "vitest";
import {decodeAgentWritingStartRequest, sameAgentWritingStartRequest, sameAgentCompactionStartRequest,
  decodeAgentWritingStartStatusResponse, decodeAgentWritingCompactionStartStatusResponse} from "./writingStartStatus";
import type {AgentWritingStartRequest} from "./submission";
import type {AgentCompactionStartRequest} from "./compaction";
const id=(n:number)=>`abcdef00-1234-5678-abcd-${String(n).padStart(12,"0")}`;
const ordinary=():AgentWritingStartRequest=>({conversationId:id(1),manuscriptId:id(2),requestId:id(3),contextSnapshotId:id(4),
  model:{providerId:"retired-provider",modelId:"retired-model",revision:null},mode:"chatGptDefault"});
const manual=():AgentCompactionStartRequest=>({conversationId:id(1),requestId:id(3),contextSnapshotId:id(4),model:ordinary().model,
  expectedRevision:0,host:{kind:"manuscript",manuscriptId:id(2)}});
const preview=(compact=false)=>({schemaVersion:1,conversationId:id(1),manuscriptId:id(2),requestId:id(3),contextSnapshotId:id(4),turnId:id(5),
  input:{text:compact?"/compact":"Original",model:ordinary().model,reasoningEffort:null,context:[{kind:"manuscript",sourceId:"writing:source",resourceId:"main.tex",revision:"frozen",
    anchor:JSON.stringify({manuscriptId:id(2),path:"main.tex"}),text:"Frozen source"}]}});
const result=()=>({schemaVersion:1,conversationId:id(1),requestId:id(3),turnId:id(5),alreadyStarted:true,outcome:null});
const detail=()=>({operationId:id(3),epoch:null,sqlFence:null,phase:"writing-start-status",sqliteCode:null,sqliteExtendedCode:null,safeCause:"writing_start_reader_unavailable"});
it("canonicalizes the complete ordinary identity while retaining Native ModelIdentity extension compatibility",()=>{
  expect(decodeAgentWritingStartRequest({...ordinary(),conversationId:`urn:uuid:${id(1).toUpperCase()}`,manuscriptId:`{${id(2).toUpperCase()}}`,
    requestId:id(3).replaceAll("-","").toUpperCase(),model:{providerId:"retired-provider",modelId:"retired-model",future:true}})).toEqual(ordinary());
  expect(sameAgentWritingStartRequest(ordinary(),{...ordinary(),contextSnapshotId:id(9)})).toBe(false);
  expect(sameAgentWritingStartRequest(ordinary(),{...ordinary(),mode:"deepSeekNonThinking"})).toBe(false);
  expect(()=>decodeAgentWritingStartRequest({...ordinary(),turnId:id(5)})).toThrow();
  expect(()=>decodeAgentWritingStartRequest({...ordinary(),requestId:"00000000-0000-0000-0000-000000000000"})).toThrow();
});
it.each([false,true])("reads the exact Native prepared preview without granting current execution, compact=%s",compact=>{
  const intent=compact?manual():ordinary(),status={type:"prepared",preview:preview(compact)},decode=compact?decodeAgentWritingCompactionStartStatusResponse:decodeAgentWritingStartStatusResponse;
  expect(decode({schemaVersion:1,intent,status})).toEqual({schemaVersion:1,intent,status});
  for(const changed of [{...preview(compact),contextSnapshotId:id(9)},{...preview(compact),manuscriptId:id(9)},
    {...preview(compact),input:{...preview(compact).input,model:{...ordinary().model,revision:"changed"}}},
    {...preview(compact),input:{...preview(compact).input,context:[]}}])
    expect(()=>decode({schemaVersion:1,intent,status:{type:"prepared",preview:changed}})).toThrow();
});
it.each([null,"completed","failed","canceled","interrupted"])("observes already accepted input with outcome %s rather than interpreting mode echo as a proof",outcome=>{
  const status={type:"started",result:{...result(),outcome}};
  for(const mode of ["chatGptDefault","deepSeekNonThinking"] as const)
    expect(decodeAgentWritingStartStatusResponse({schemaVersion:1,intent:{...ordinary(),mode},status}).status).toEqual(status);
  expect(decodeAgentWritingCompactionStartStatusResponse({schemaVersion:1,intent:manual(),status}).status).toEqual(status);
});
it("requires alreadyStarted and exact C/R while leaving expected T validation to the original owner",()=>{
  for(const patch of [{alreadyStarted:false},{conversationId:id(9)},{requestId:id(9)}])
    expect(()=>decodeAgentWritingStartStatusResponse({schemaVersion:1,intent:ordinary(),status:{type:"started",result:{...result(),...patch}}})).toThrow();
  expect(decodeAgentWritingStartStatusResponse({schemaVersion:1,intent:ordinary(),status:{type:"started",result:{...result(),turnId:id(99)}}}).status.type).toBe("started");
});
it("manual status keeps original W and only accepts Manuscript host scope",()=>{
  expect(sameAgentCompactionStartRequest(manual(),{...manual(),expectedRevision:1})).toBe(false);
  expect(sameAgentCompactionStartRequest(manual(),{...manual(),host:{kind:"manuscript",manuscriptId:id(9)}})).toBe(false);
  for(const intent of [{...manual(),host:{kind:"note",pageId:id(2)}},{...manual(),expectedRevision:Number.MAX_SAFE_INTEGER+1}])
    expect(()=>decodeAgentWritingCompactionStartStatusResponse({schemaVersion:1,intent,status:{type:"notFound"}})).toThrow();
  expect(()=>decodeAgentWritingCompactionStartStatusResponse({schemaVersion:1,intent:manual(),status:{type:"prepared",preview:preview()}})).toThrow();
});
it("retains all seven safe diagnosis fields and rejects a foreign operation or incomplete diagnosis",()=>{
  const diagnostic={...detail(),epoch:id(8),sqlFence:"18446744073709551615",sqliteCode:"DatabaseBusy",sqliteExtendedCode:517};
  expect(decodeAgentWritingStartStatusResponse({schemaVersion:1,intent:ordinary(),status:{type:"unconfirmed",detail:diagnostic}}).status).toEqual({type:"unconfirmed",detail:diagnostic});
  for(const missing of Object.keys(detail())){const changed:Record<string,unknown>={...detail()};delete changed[missing];
    expect(()=>decodeAgentWritingStartStatusResponse({schemaVersion:1,intent:ordinary(),status:{type:"unconfirmed",detail:changed}})).toThrow();}
  expect(()=>decodeAgentWritingStartStatusResponse({schemaVersion:1,intent:ordinary(),status:{type:"unconfirmed",detail:{...detail(),operationId:id(9)}}})).toThrow();
});
it("keeps observations separate from queued admission and SQL proof variants",()=>{
  for(const status of [{type:"admitted",preview:preview()},{type:"started",result:result(),proof:{}},{type:"prepared",preview:preview(),expectedRevision:0},{type:"notFound",detail:detail()}])
    expect(()=>decodeAgentWritingStartStatusResponse({schemaVersion:1,intent:ordinary(),status})).toThrow();
});
