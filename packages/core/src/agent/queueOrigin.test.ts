import {expect,it} from "vitest";
import {decodeAgentQueueState,decodeAgentQueueCommand} from "./submission";
const id="11111111-1111-4111-8111-111111111111";
const inputId="22222222-2222-4222-8222-222222222222";
const state={schemaVersion:1,conversationId:id,revision:1,paused:false,preparingInputId:null,inputs:[{inputId,text:"queued"}]};

it("reads legacy unknown origins and preserves all typed origins in copied responses",()=>{
  expect(decodeAgentQueueState(state).inputs[0]?.origin).toBeUndefined();
  for(const kind of ["manuscript","paper","note","readingNote"] as const){
    const origin={kind,resourceId:id};
    const decoded=decodeAgentQueueState({...state,inputs:[{inputId,text:"queued",origin}]});
    expect(decoded.inputs[0]?.origin).toEqual(origin);expect(decoded.inputs[0]?.origin).not.toBe(origin);
  }
});

it("rejects invalid or authority-bearing origins and never accepts origin from an edit request",()=>{
  for(const origin of [null,{kind:"other",resourceId:id},{kind:"note",resourceId:"00000000-0000-0000-0000-000000000000"},{kind:"note",resourceId:id,permissions:["shell"]}]){
    expect(()=>decodeAgentQueueState({...state,inputs:[{inputId,text:"queued",origin}]})).toThrow();
  }
  expect(()=>decodeAgentQueueCommand({requestId:id,expectedRevision:0,edit:{type:"add",inputId,text:"queued",origin:{kind:"note",resourceId:id}}})).toThrow();
});

it("validates per-message pause and claims the first eligible entry", () => {
  const nextId = "33333333-3333-4333-8333-333333333333";
  const inputs = [{inputId, text: "held", paused: true}, {inputId: nextId, text: "eligible"}];
  expect(decodeAgentQueueState({...state, inputs, preparingInputId: nextId}).preparingInputId).toBe(nextId);
  expect(() => decodeAgentQueueState({...state, inputs, preparingInputId: inputId})).toThrow();
  expect(() => decodeAgentQueueState({...state, inputs: [{inputId, text: "held", paused: "yes"}]})).toThrow();
  for (const type of ["pauseInput", "resumeInput"] as const) {
    expect(decodeAgentQueueCommand({requestId: id, expectedRevision: 1, edit: {type, inputId}}).edit).toEqual({type, inputId});
    expect(() => decodeAgentQueueCommand({requestId: id, expectedRevision: 1, edit: {type}})).toThrow();
  }
});
