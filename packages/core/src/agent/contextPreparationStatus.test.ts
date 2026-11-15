import {expect, it} from "vitest";
import {decodeAgentContextPrepareIntent, decodeAgentContextPrepareStatusResponse, sameAgentContextPrepareIntent} from "./contextPreparationStatus";
const id = (n: number) => `abcdef00-1234-4678-abcd-${String(n).padStart(12,"0")}`;
const request = {conversationId:id(1),requestId:id(2),text:"Question",resources:[{kind:"paper" as const,resourceId:"paper"}]};
const native = {...request,userInput:[],retrieval:null,model:null,queue:null};
const detail = {operationId:id(2),epoch:id(3),sqlFence:"0",phase:"context-prepare-status",sqliteCode:null,sqliteExtendedCode:null,safeCause:"context_prepare_worker_unconfirmed"};
const preview = {schemaVersion:1,conversationId:id(1),requestId:id(2),turnId:id(4),contextSnapshotId:id(5),
  input:{text:"Question",model:{providerId:"fixture",modelId:"model",revision:null},reasoningEffort:null,context:[]}};
const proof = {schemaVersion:1,operationId:id(2),conversationId:id(1),family:"agent.context.submission.prepare",epoch:id(3),sqlFence:"9007199254740993",replayed:false,result:null};
it("normalizes native defaults without changing the frozen original request", () => {
  expect(sameAgentContextPrepareIntent(request,native)).toBe(true);
  expect(decodeAgentContextPrepareIntent(native)).toMatchObject({resources:request.resources,userInput:[],model:null,queue:null});
  expect(sameAgentContextPrepareIntent(request,{...request,text:"Changed"})).toBe(false);
  expect(sameAgentContextPrepareIntent(request,{...request,resources:[{kind:"paper",resourceId:"another"}]})).toBe(false);
});
it("decodes unconfirmed status without treating absence as failure or permission", () => {
  const value = {schemaVersion:1,intent:native,expectedEpoch:null,status:{type:"unconfirmed",detail}};
  expect(decodeAgentContextPrepareStatusResponse(value).status).toMatchObject({type:"unconfirmed",detail});
  expect(() => decodeAgentContextPrepareStatusResponse({...value,expectedEpoch:id(9)})).toThrow();
  expect(() => decodeAgentContextPrepareStatusResponse({...value,status:{type:"unconfirmed",detail:{...detail,operationId:id(9)}}})).toThrow();
});
it("checks full original identity, epoch, result and lossless fence on committed status", () => {
  const value = {schemaVersion:1,intent:native,expectedEpoch:id(3),status:{type:"committed",proof,result:preview}};
  expect(decodeAgentContextPrepareStatusResponse(value).status).toMatchObject({type:"committed",proof,result:preview});
  for (const invalid of [
    {...value,expectedEpoch:id(9)},
    {...value,status:{...value.status,proof:{...proof,operationId:id(9)}}},
    {...value,status:{...value.status,proof:{...proof,sqlFence:9007199254740993}}},
    {...value,status:{...value.status,result:{...preview,input:{...preview.input,text:"Changed"}}}},
    {...value,status:{...value.status,result:{...preview,queue:{inputId:id(6),expectedRevision:1}}}},
  ]) expect(() => decodeAgentContextPrepareStatusResponse(invalid)).toThrow();
});
it("checks the frozen queue identity and expected revision", () => {
  const intent = {...native,queue:{inputId:id(6),expectedRevision:4}};
  const value = {schemaVersion:1,intent,expectedEpoch:id(3),status:{type:"committed",proof,result:{...preview,queue:{inputId:id(6),expectedRevision:5}}}};
  expect(decodeAgentContextPrepareStatusResponse(value).status.type).toBe("committed");
  expect(() => decodeAgentContextPrepareStatusResponse({...value,status:{...value.status,result:{...preview,queue:{inputId:id(6),expectedRevision:6}}}})).toThrow();
});
