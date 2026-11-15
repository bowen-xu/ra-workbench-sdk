import {expect,it,vi} from "vitest";
import {AgentNoteSubmissionDecodeError,type AgentNoteRecoveryRequest} from "@research-assistant/core/agent";
import {createAgentNoteRecoveryGateway} from "./noteRecovery";
const conversationId="a1111111-1111-4111-8111-111111111111";
const pageId="b1111111-1111-4111-8111-111111111111";
const requestId="c1111111-1111-4111-8111-111111111111";
const turnId="d1111111-1111-4111-8111-111111111111";
function request():AgentNoteRecoveryRequest {return {conversationId,pageId,after:null,limit:20};}
function page() {return {schemaVersion:1,conversationId,pageId,nextCursor:null,items:[{requestId,turnId,messageExcerpt:"Synthetic excerpt",createdAt:"2026-09-10T12:00:00.000Z"}]};}

it("lists only bounded metadata and preserves scope while an IPC reply is pending",async()=>{
  let finish!:(value:unknown)=>void;
  const invoke=vi.fn((_command,args)=>{args.request.pageId=conversationId;return new Promise(done=>{finish=done;});});
  const input={...request()};
  const waiting=createAgentNoteRecoveryGateway(invoke).list(input);input.pageId=conversationId;
  finish(page());expect(await waiting).toEqual(page());
  expect(invoke.mock.calls[0]?.[0]).toBe("agent_list_unstarted_note_submissions");
  expect(invoke).toHaveBeenCalledOnce();
});
it("accepts a full page cursor and an empty following page",async()=>{
  const result={...page(),nextCursor:requestId};
  const invoke=vi.fn().mockResolvedValue(result);
  const gateway=createAgentNoteRecoveryGateway(invoke);
  expect((await gateway.list({...request(),limit:1})).nextCursor).toBe(requestId);
  invoke.mockResolvedValue({...page(),items:[]});
  expect((await gateway.list({...request(),after:requestId,limit:1})).items).toEqual([]);
});
it("rejects response scope, order, duplicate, cursor and unexpected payload changes",async()=>{
  const original=page();
  for(const value of [
    {...original,pageId:conversationId},{...original,conversationId:pageId},
    {...original,items:[original.items[0],original.items[0]]},
    {...original,nextCursor:requestId},
    {...original,items:[{...original.items[0],messageExcerpt:"x".repeat(201)}]},
    {...original,items:[{...original.items[0],createdAt:"not a date"}]},
    {...original,items:[{...original.items[0],input:{text:"Unexpected source"}}]},
  ]) {
    await expect(createAgentNoteRecoveryGateway(vi.fn().mockResolvedValue(value)).list(request())).rejects.toBeInstanceOf(AgentNoteSubmissionDecodeError);
  }
  await expect(createAgentNoteRecoveryGateway(vi.fn().mockResolvedValue(original)).list({...request(),after:requestId})).rejects.toBeInstanceOf(AgentNoteSubmissionDecodeError);
});
it("validates pagination before IPC and propagates native access revocation without retry",async()=>{
  const invoke=vi.fn().mockRejectedValue("unbound");
  const gateway=createAgentNoteRecoveryGateway(invoke);
  for(const input of [{...request(),limit:0},{...request(),limit:65},{...request(),after:"invalid"},{...request(),start:true}]) {
    await expect(gateway.list(input)).rejects.toBeInstanceOf(AgentNoteSubmissionDecodeError);
  }
  expect(invoke).not.toHaveBeenCalled();
  await expect(gateway.list(request())).rejects.toBe("unbound");expect(invoke).toHaveBeenCalledOnce();
});
