import { expect, it, vi } from "vitest";
import { decodeAgentEditorRestorationResponse } from "@research-assistant/core/agent";
import { createAgentEditorRestorationGateway } from "./editorRestorations";
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const scope={conversationId:id(1),manuscriptId:id(2),proposalId:id(3),operationId:id(4)};
const current={path:"main.tex",sessionId:id(5),revision:id(7),text:"after\r\n中文"};
const restoration={id:id(8),sessionId:id(5),expectedRevision:id(7),resultRevision:null};
const application={kind:"state",schemaVersion:1,scope,status:"recoveryRequired",files:[{path:"main.tex",phase:"acknowledged",target:{kind:"editor",sessionId:id(5),revision:id(6),resultRevision:id(7)}}]};
const state={kind:"state",schemaVersion:1,application,path:"main.tex",restoration};
const edit={kind:"edit",schemaVersion:1,scope,restoreId:id(8),expected:current,text:"before\r\n中文"};
it("freezes restore preparation and rejects foreign identities or observations",async()=>{
  const invoke=vi.fn().mockResolvedValue(edit),gateway=createAgentEditorRestorationGateway(invoke);
  const request={action:"prepare" as const,scope:{...scope},restoreId:id(8),current:{...current}};
  const pending=gateway.execute(request);request.current.text="later";request.scope.operationId=id(99);
  expect(await pending).toEqual(edit);
  expect(invoke).toHaveBeenCalledWith("agent_writing_editor_restoration",{request:{action:"prepare",scope,restoreId:id(8),current}});
  for(const invalid of [{...edit,restoreId:id(9)},{...edit,expected:{...current,revision:id(9)}},{...edit,scope:{...scope,manuscriptId:id(9)}}]) {
    invoke.mockResolvedValue(invalid);
    await expect(gateway.execute({action:"prepare",scope,restoreId:id(8),current})).rejects.toThrow();
  }
});
it("read returns missing or durable intent but never a dispatch",async()=>{
  const invoke=vi.fn().mockResolvedValue({...state,restoration:null}),gateway=createAgentEditorRestorationGateway(invoke);
  expect((await gateway.execute({action:"read",scope,path:"main.tex"})).kind).toBe("state");
  invoke.mockResolvedValue(state);
  expect(await gateway.execute({action:"read",scope,path:"main.tex"})).toEqual(state);
  for(const path of ["../main.tex","other.tex"]) await expect(gateway.execute({action:"read",scope,path})).rejects.toThrow();
  invoke.mockResolvedValue(edit);
  await expect(gateway.execute({action:"read",scope,path:"main.tex"})).rejects.toThrow();
});
it("confirmation requires its exact durable result revision",async()=>{
  const restored={...state,restoration:{...restoration,resultRevision:id(9)},application:{...application,status:"rolledBack",files:[{...application.files[0],phase:"restored"}]}};
  const invoke=vi.fn().mockResolvedValue(restored),gateway=createAgentEditorRestorationGateway(invoke);
  const request={action:"confirm" as const,scope,restoreId:id(8),actual:{...current,revision:id(9),text:edit.text}};
  expect(await gateway.execute(request)).toEqual(restored);
  for(const invalid of [state,edit,{...restored,restoration:{...restored.restoration,resultRevision:id(10)}}]) {
    invoke.mockResolvedValue(invalid);await expect(gateway.execute(request)).rejects.toThrow();
  }
});
it("rejects impossible restoration states and unsupported protocol fields",()=>{
  for(const invalid of [
    {...state,schemaVersion:2},{...state,extra:true},
    {...state,restoration:{...restoration,id:scope.operationId}},
    {...state,restoration:{...restoration,expectedRevision:id(99)}},
    {...state,restoration:{...restoration,resultRevision:id(7)}},
    {...state,restoration:{...restoration,resultRevision:id(9)}},
    {...state,application:{...application,status:"applied"}},
    {...state,restoration:null,application:{...application,files:[{...application.files[0],phase:"restored"}]}},
  ]) expect(()=>decodeAgentEditorRestorationResponse(invalid)).toThrow();
});
it("reads a rebuilt-owner restoration without rewriting the original receipt or granting dispatch", async () => {
  const rebuilt = {...state, restoration: {...restoration, sessionId: id(20), expectedRevision: id(21)}};
  const invoke = vi.fn().mockResolvedValue(rebuilt), gateway = createAgentEditorRestorationGateway(invoke);
  expect(await gateway.execute({action: "read", scope, path: "main.tex"})).toEqual(rebuilt);
  expect(rebuilt.application.files[0]!.target.resultRevision).toBe(id(7));
  const observed = {...current, sessionId: id(20), revision: id(21)};
  invoke.mockResolvedValue({...edit, expected: observed});
  await expect(gateway.execute({action: "read", scope, path: "main.tex"})).rejects.toThrow();
  await expect(gateway.execute({action: "prepare", scope, restoreId: id(8), current})).rejects.toThrow();
  expect(await gateway.execute({action: "prepare", scope, restoreId: id(8), current: observed,
    checkpointVersion: {path: "main.tex", revision: 3, stateVersion: 4}})).toEqual({...edit, expected: observed});
});
