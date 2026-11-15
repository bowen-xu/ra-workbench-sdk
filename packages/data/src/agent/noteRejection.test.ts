import {it,expect,vi} from "vitest";
import {createAgentNoteRejectionGateway} from "./noteRejection";
import {decodeAgentNoteRejection} from "@research-assistant/core/agent";
const scope={conversationId:"a1111111-1111-4111-8111-111111111111",pageId:"b1111111-1111-4111-8111-111111111111",turnId:"c1111111-1111-4111-8111-111111111111",itemId:"d1111111-1111-4111-8111-111111111111"};
const requestId="e1111111-1111-4111-8111-111111111111",proposalId=`note-rewrite:${"a".repeat(64)}`;
const receipt=()=>({schemaVersion:1,...scope,decisionId:requestId,proposalId,createdAt:"2026-09-10T01:02:03.000Z"});
it("captures scope, accepts the canonical decision ID and sends no proposed content",async()=>{
  let resolve!:(v:unknown)=>void;const invoke=vi.fn(()=>new Promise(r=>{resolve=r;}));const mutable={...scope};
  const pending=createAgentNoteRejectionGateway(invoke).reject(mutable,requestId,proposalId);
  mutable.pageId=requestId;
  expect(invoke).toHaveBeenCalledWith("agent_reject_note_rewrite",{request:{scope,requestId}});
  const saved={...receipt(),decisionId:scope.itemId};resolve(saved);
  expect(await pending).toEqual(saved);
});
it("distinguishes no decision from read failure without issuing a mutation",async()=>{
  const invoke=vi.fn().mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("offline"));const gateway=createAgentNoteRejectionGateway(invoke);
  expect(await gateway.status(scope,proposalId)).toBeNull();await expect(gateway.status(scope,proposalId)).rejects.toThrow("offline");
  expect(invoke.mock.calls.every(c=>c[0]==="agent_note_rejection_status")).toBe(true);
});
it("rejects mismatched scopes, proposal identities, schemas and timestamps",()=>{
  for(const patch of [{pageId:requestId},{proposalId:`note-rewrite:${"b".repeat(64)}`},{schemaVersion:2},{createdAt:"2026-02-30T01:02:03.000Z"},{decisionId:"bad"},{extra:true}]) {
    expect(()=>decodeAgentNoteRejection({...receipt(),...patch},scope,proposalId)).toThrow();
  }
});
it("rejects invalid mutation inputs before IPC and never retries an uncertain write",async()=>{
  const invoke=vi.fn().mockRejectedValue(new Error("unknown result"));const gateway=createAgentNoteRejectionGateway(invoke);
  await expect(gateway.reject({...scope,allowWrite:true} as typeof scope,requestId,proposalId)).rejects.toThrow();
  await expect(gateway.reject(scope,"invalid",proposalId)).rejects.toThrow();
  await expect(gateway.reject(scope,requestId,"invalid")).rejects.toThrow();expect(invoke).not.toHaveBeenCalled();
  await expect(gateway.reject(scope,requestId,proposalId)).rejects.toThrow("unknown result");expect(invoke).toHaveBeenCalledOnce();
});
