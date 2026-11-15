import { expect, it, vi } from "vitest";
import { decodeAgentUndoEditorRestorationRequest, decodeAgentUndoEditorRestorationResponse } from "@research-assistant/core/agent";
import { createAgentUndoEditorRestorationGateway } from "./undoEditorRestorations";
const id = () => crypto.randomUUID();
const originalScope = {conversationId:id(),manuscriptId:id(),proposalId:id(),operationId:id()};
const scope = {...originalScope,operationId:id()};
const current = {path:"main.tex",sessionId:id(),revision:id(),text:"before"};
const request = {action:"prepare" as const,scope,restoreId:id(),current};
const result = {kind:"edit",schemaVersion:1,scope,restoreId:request.restoreId,expected:current,text:"restored"};
it("freezes both scopes and uses the dedicated undo restoration endpoint",async()=>{
  const invoke=vi.fn().mockResolvedValue({originalScope,result}), original={...originalScope};
  const gateway=createAgentUndoEditorRestorationGateway(invoke,original);
  original.operationId=id();
  const input={...request,scope:{...scope},current:{...current}};
  const pending=gateway.execute(input); input.current.text="later"; input.scope.operationId=id();
  expect(await pending).toEqual(result);
  expect(invoke).toHaveBeenCalledWith("agent_writing_undo_editor_restoration",{request:{originalScope,request}});
});
it("rejects unrelated originals, undo operations and unexpected dispatches",async()=>{
  const invoke=vi.fn(), gateway=createAgentUndoEditorRestorationGateway(invoke,originalScope);
  for(const response of [
    {originalScope:{...originalScope,operationId:id()},result},
    {originalScope,result:{...result,scope:{...scope,operationId:id()}}},
    {originalScope,result:{...result,restoreId:originalScope.operationId}},
    {originalScope,result:{...result,expected:{...current,text:"wrong"}}},
  ]) {invoke.mockResolvedValue(response);await expect(gateway.execute(request)).rejects.toThrow();}
  invoke.mockResolvedValue({originalScope,result});
  await expect(gateway.execute({action:"read",scope,path:"main.tex"})).rejects.toThrow();
});
it("rejects invalid envelope fields and identity relations before dispatch",()=>{
  for(const invalid of [
    {originalScope,request,extra:true},
    {originalScope,request:{...request,scope:originalScope}},
    {originalScope,request:{...request,restoreId:originalScope.operationId}},
    {originalScope,request:{...request,scope:{...scope,manuscriptId:id()}}},
  ]) expect(()=>decodeAgentUndoEditorRestorationRequest(invalid)).toThrow();
  expect(()=>decodeAgentUndoEditorRestorationResponse({originalScope,result,extra:true})).toThrow();
});

it("freezes checkpoint CAS for a fresh Undo compensation and rejects invalid proof fields", async () => {
  const proof = { path: current.path, revision: 3, stateVersion: 7 };
  const input = { ...request, checkpointVersion: proof };
  const invoke = vi.fn().mockResolvedValue({ originalScope, result });
  const pending = createAgentUndoEditorRestorationGateway(invoke, originalScope).execute(input);
  proof.revision = 99;
  await pending;
  expect(invoke.mock.calls[0]?.[1]).toEqual({ request: { originalScope, request: {
    ...request, checkpointVersion: { path: current.path, revision: 3, stateVersion: 7 },
  } } });
  for (const invalid of [null, { ...proof, path: "other.tex" }, { ...proof, revision: 0 },
    { ...proof, revision: Number.MAX_SAFE_INTEGER + 1 }, { ...proof, stateVersion: -1 },
    { ...proof, stateVersion: 1.5 }, { ...proof, extra: true }]) {
    expect(() => decodeAgentUndoEditorRestorationRequest({ originalScope,
      request: { ...request, checkpointVersion: invalid } })).toThrow();
  }
  expect(() => decodeAgentUndoEditorRestorationRequest({ originalScope,
    request: { action: "confirm", scope, restoreId: request.restoreId, actual: current, checkpointVersion: proof } })).toThrow();
});

it("reads and confirms a rebuilt compensation without rewriting the original Undo owner", async () => {
  const target = { kind: "editor", sessionId: id(), revision: id(), resultRevision: id() };
  const restoration = { id: request.restoreId, sessionId: current.sessionId, expectedRevision: current.revision, resultRevision: null };
  const state = { kind: "state", schemaVersion: 1, path: current.path, restoration, application: {
    kind: "state", schemaVersion: 1, scope, status: "recoveryRequired",
    files: [{ path: current.path, phase: "acknowledged", target }],
  } };
  const invoke = vi.fn().mockResolvedValue({ originalScope, result: state });
  const gateway = createAgentUndoEditorRestorationGateway(invoke, originalScope);
  expect(await gateway.execute({ action: "read", scope, path: current.path })).toEqual(state);
  const actual = { ...current, revision: id(), text: "restored" };
  const confirmed = { ...state, restoration: { ...restoration, resultRevision: actual.revision },
    application: { ...state.application, status: "rolledBack", files: [{ ...state.application.files[0], phase: "restored" }] } };
  invoke.mockResolvedValue({ originalScope, result: confirmed });
  expect(await gateway.execute({ action: "confirm", scope, restoreId: request.restoreId, actual })).toEqual(confirmed);
  expect(confirmed.application.files[0]?.target).toEqual(target);
  for (const invalid of [
    { ...state, restoration: { ...restoration, sessionId: target.sessionId } },
    { ...confirmed, restoration: { ...confirmed.restoration, resultRevision: current.revision } },
    { ...confirmed, application: { ...confirmed.application, status: "applied" } },
  ]) expect(() => decodeAgentUndoEditorRestorationResponse({ originalScope, result: invalid })).toThrow();
});
