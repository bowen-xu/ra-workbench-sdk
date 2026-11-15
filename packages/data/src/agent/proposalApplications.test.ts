import { expect, it, vi } from "vitest";
import { decodeAgentApplicationResponse, type AgentApplicationRequest } from "@research-assistant/core/agent";
import { createAgentApplicationGateway } from "./proposalApplications";
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const scope={conversationId:id(1),manuscriptId:id(2),proposalId:id(3),operationId:id(4)};
const current={path:"main.tex",sessionId:id(5),revision:id(6),text:"before\r\n中文"};
const edit={kind:"edit",schemaVersion:1,scope,expected:current,text:"after\r\n中文"};
const state={kind:"state",schemaVersion:1,scope,status:"applying",files:[{path:"main.tex",phase:"dispatched",target:{kind:"editor",sessionId:id(5),revision:id(6),resultRevision:null}}]};
it("rolls back only the scoped disk plan and rejects incomplete or editor replies",async()=>{
  const restored={...state,status:"rolledBack",files:[{path:"main.tex",phase:"restored",target:{kind:"disk"}}]};
  const invoke=vi.fn().mockResolvedValue(restored), gateway=createAgentApplicationGateway(invoke);
  const request={action:"rollbackDisk" as const,scope:{...scope}};
  const pending=gateway.execute(request); request.scope.operationId=id(9);
  expect(await pending).toEqual(restored);
  expect(invoke).toHaveBeenCalledWith("agent_writing_proposal_application",{request:{action:"rollbackDisk",scope}});
  for(const invalid of [state,edit,{...restored,scope:request.scope},{...restored,files:[{...state.files[0],phase:"restored"}]}]) {
    invoke.mockResolvedValue(invalid);
    await expect(gateway.execute({action:"rollbackDisk",scope})).rejects.toThrow();
  }
});
it.each(["applyDisk", "reconcileDisk"] as const)("%s freezes disk paths and rejects editor or foreign-path replies",async(action)=>{
  const disk={...state,files:[{path:"main.tex",phase:"dispatched",target:{kind:"disk"}}]};
  const invoke=vi.fn().mockResolvedValue(disk), gateway=createAgentApplicationGateway(invoke);
  const request={action,scope,path:"main.tex"};
  const pending=gateway.execute(request);request.path="changed.tex";
  expect(await pending).toEqual(disk);
  expect(invoke).toHaveBeenCalledExactlyOnceWith("agent_writing_proposal_application",{request:{action,scope,path:"main.tex"}});
  for(const response of [state,edit,{...disk,files:[{...disk.files[0],path:"other.tex"}]}]) {
    invoke.mockResolvedValue(response);
    await expect(gateway.execute({action,scope,path:"main.tex"})).rejects.toThrow();
  }
});
it("finds the durable operation from the proposal and rejects foreign or executable replies",async()=>{
  const invoke=vi.fn().mockResolvedValue(null),gateway=createAgentApplicationGateway(invoke);
  const request={conversationId:scope.conversationId,manuscriptId:scope.manuscriptId,proposalId:scope.proposalId};
  expect(await gateway.find(request)).toBeNull();
  expect(invoke).toHaveBeenCalledWith("agent_find_writing_proposal_application",{request});
  invoke.mockResolvedValue(state);
  const pending=gateway.find(request);request.proposalId=id(9);
  expect(await pending).toEqual(state);
  await expect(gateway.find(request)).rejects.toThrow();
  invoke.mockResolvedValue(edit);
  await expect(gateway.find({...request,proposalId:scope.proposalId})).rejects.toThrow();
});
it("round trips native actions and binds edit replies to the frozen observation",async()=>{
  const invoke=vi.fn().mockResolvedValue(edit), gateway=createAgentApplicationGateway(invoke);
  const request={action:"prepareEditor" as const,scope,current:{...current}};
  const pending=gateway.execute(request); request.current.text="later";
  expect(await pending).toEqual(edit);
  expect(invoke).toHaveBeenCalledWith("agent_writing_proposal_application",{request:{action:"prepareEditor",scope,current}});
  for(const changed of [{...edit,scope:{...scope,manuscriptId:id(9)}},{...edit,expected:{...current,revision:id(9)}}]) {
    invoke.mockResolvedValue(changed);
    await expect(gateway.execute({action:"prepareEditor",scope,current})).rejects.toThrow();
  }
  invoke.mockResolvedValue(edit);
  await expect(gateway.execute({action:"read",scope})).rejects.toThrow();
});
it("returns existing state without creating a second command and validates confirmation identity",async()=>{
  const invoke=vi.fn().mockResolvedValue(state), gateway=createAgentApplicationGateway(invoke);
  expect(await gateway.execute({action:"prepareEditor",scope,current})).toEqual(state);
  const request:AgentApplicationRequest={action:"confirmEditor",scope,actual:{...current,revision:id(7),text:edit.text}};
  await expect(gateway.execute(request)).rejects.toThrow();
  const acknowledged={...state,status:"applied",files:[{...state.files[0],phase:"acknowledged",target:{kind:"editor",sessionId:id(5),revision:id(6),resultRevision:id(7)}}]};
  invoke.mockResolvedValue(acknowledged);
  expect(await gateway.execute(request)).toEqual(acknowledged);
  invoke.mockResolvedValue({...acknowledged,files:[{...acknowledged.files[0],target:{kind:"editor",sessionId:id(9),revision:id(6),resultRevision:id(7)}}]});
  await expect(gateway.execute(request)).rejects.toThrow();
});
it("round trips resume admission and requires an applying state",async()=>{
  const pendingState={...state,status:"applying",files:[{...state.files[0],phase:"pending",target:{kind:"editor",sessionId:id(5),revision:id(6),resultRevision:null}}]};
  const invoke=vi.fn().mockResolvedValue(pendingState),gateway=createAgentApplicationGateway(invoke);
  const buffers=[{path:"main.tex",expectedDiskSha256:"a".repeat(64),sessionId:id(5),revision:id(6),text:"before"}];
  expect(await gateway.execute({action:"resume",scope,buffers})).toEqual(pendingState);
  expect(invoke).toHaveBeenCalledWith("agent_writing_proposal_application",{request:{action:"resume",scope,buffers}});
  invoke.mockResolvedValue({...pendingState,status:"recoveryRequired"});
  await expect(gateway.execute({action:"resume",scope,buffers})).rejects.toThrow();
});
it("rejects impossible progress, duplicate paths, extra fields and unsafe paths",()=>{
  for(const invalid of [
    {...state,status:"applied"},{...state,status:"rolledBack"},{...state,files:[]},
    {...state,files:[...state.files,...state.files]}, {...state,extra:true},
    {...state,files:[{...state.files[0],path:"../main.tex"}]},
    {...state,files:[{...state.files[0],path:".agent-before-hidden"}]},
    {...state,files:[{...state.files[0],phase:"acknowledged"}]},
    {...edit,text:current.text},{...edit,expected:{...current,text:"\ud800"}},
  ]) expect(()=>decodeAgentApplicationResponse(invalid)).toThrow();
});
it("completes a mixed rollback remainder without weakening the disk-only action",async()=>{
  const complete={...state,status:"rolledBack",files:[{...state.files[0],phase:"restored",target:{kind:"editor",sessionId:id(5),revision:id(6),resultRevision:id(7)}},{path:"other.tex",phase:"restored",target:{kind:"disk"}}]};
  const invoke=vi.fn().mockResolvedValue(complete),gateway=createAgentApplicationGateway(invoke);
  const request={action:"rollbackRemainder" as const,scope:{...scope}};
  const pending=gateway.execute(request);request.scope.operationId=id(99);
  expect(await pending).toEqual(complete);
  expect(invoke).toHaveBeenCalledWith("agent_writing_proposal_application",{request:{action:"rollbackRemainder",scope}});
  await expect(gateway.execute({action:"rollbackDisk",scope})).rejects.toThrow();
  for(const invalid of [state,edit,{...complete,scope:request.scope},{...complete,files:[{...state.files[0],phase:"restored"}]}]) {
    invoke.mockResolvedValue(invalid);
    await expect(gateway.execute({action:"rollbackRemainder",scope})).rejects.toThrow();
  }
});
it.each(["prepareRollback", "rollbackRemainder"] as const)("%s freezes checkpoint admission rather than discarding it", async action => {
  const response = {...state, status: action === "prepareRollback" ? "recoveryRequired" : "rolledBack",
    files: [{...state.files[0], phase: action === "prepareRollback" ? "acknowledged" : "restored",
      target: {kind: "editor", sessionId: id(5), revision: id(6), resultRevision: id(7)}}]};
  const invoke = vi.fn().mockResolvedValue(response), gateway = createAgentApplicationGateway(invoke);
  const buffers = [{...current, sessionId: id(20), revision: id(21), expectedDiskSha256: "a".repeat(64)}];
  const checkpointVersions = [{path: "main.tex", revision: 3, stateVersion: 4}];
  const request = {action, scope: {...scope}, buffers, checkpointVersions};
  const pending = gateway.execute(request);
  request.scope.operationId = id(99); buffers[0]!.text = "later"; checkpointVersions[0]!.stateVersion = 99;
  expect(await pending).toEqual(response);
  expect(invoke).toHaveBeenCalledExactlyOnceWith("agent_writing_proposal_application", {request: {
    action, scope, buffers: [{...current, sessionId: id(20), revision: id(21), expectedDiskSha256: "a".repeat(64)}],
    checkpointVersions: [{path: "main.tex", revision: 3, stateVersion: 4}],
  }});
});
it("rejects malformed whole-plan admission before invoking native code", async () => {
  const invoke = vi.fn(), gateway = createAgentApplicationGateway(invoke);
  const buffer = {...current, expectedDiskSha256: "a".repeat(64)}, proof = {path: "main.tex", revision: 1, stateVersion: 0};
  const request = {action: "prepareRollback", scope, buffers: [buffer], checkpointVersions: [proof]};
  for (const invalid of [
    {...request, extra: true}, {...request, buffers: [buffer, buffer]},
    {...request, buffers: [{...buffer, expectedDiskSha256: "wrong"}]},
    {...request, buffers: [{...buffer, text: "\ud800"}]},
    {...request, checkpointVersions: [proof, proof]},
    {...request, checkpointVersions: [{...proof, path: "other.tex"}]},
    {...request, checkpointVersions: [{...proof, revision: 0}]},
    {...request, checkpointVersions: [{...proof, stateVersion: -1}]},
    {action: "rollbackRemainder", scope, checkpointVersions: [proof]},
  ]) await expect(gateway.execute(invalid as AgentApplicationRequest)).rejects.toThrow();
  expect(invoke).not.toHaveBeenCalled();
});
it("preparation accepts only recovery or terminal state and never authorizes an editor dispatch", async () => {
  const recovered = {...state, status: "recoveryRequired"};
  const invoke = vi.fn().mockResolvedValue(recovered), gateway = createAgentApplicationGateway(invoke);
  const request = {action: "prepareRollback" as const, scope, buffers: []};
  expect(await gateway.execute(request)).toEqual(recovered);
  for (const invalid of [state, edit, {...recovered, scope: {...scope, operationId: id(99)}}]) {
    invoke.mockResolvedValue(invalid); await expect(gateway.execute(request)).rejects.toThrow();
  }
});
