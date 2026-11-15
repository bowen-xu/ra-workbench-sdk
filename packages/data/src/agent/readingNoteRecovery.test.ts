import {expect,it,vi} from "vitest";
import {type AgentReadingNoteRecoveryRequest} from "@research-assistant/core/agent";
import {createAgentReadingNoteRecoveryGateway} from "./readingNoteRecovery";

const conversationId="a1111111-1111-4111-8111-111111111111";
const readingNoteId="b1111111-1111-4111-8111-111111111111";
const requestId="c1111111-1111-4111-8111-111111111111";
const turnId="d1111111-1111-4111-8111-111111111111";
function request():AgentReadingNoteRecoveryRequest {return {conversationId,readingNoteId,after:null,limit:20};}
function page() {return {schemaVersion:1,conversationId,readingNoteId,nextCursor:null,items:[{requestId,turnId,messageExcerpt:"Frozen reading question",createdAt:"2026-09-11T12:00:00.000Z"}]};}

it("discovers bounded reading metadata with immutable caller and IPC scope",async()=>{
  let finish!:(value:unknown)=>void;
  const invoke=vi.fn((_command,args)=>{args.request.readingNoteId=conversationId;return new Promise(done=>{finish=done;});});
  const input=request(),waiting=createAgentReadingNoteRecoveryGateway(invoke).list(input);
  // Caller mutation cannot redirect the pending response check.
  Object.assign(input,{readingNoteId:conversationId});finish(page());
  expect(await waiting).toEqual(page());
  expect(invoke.mock.calls[0]?.[0]).toBe("agent_list_unstarted_reading_note_submissions");
  expect(invoke).toHaveBeenCalledOnce();
});
it("keeps pagination strict and rejects Note Page identity even with the same UUID",async()=>{
  const invoke=vi.fn().mockResolvedValue({...page(),nextCursor:requestId}),gateway=createAgentReadingNoteRecoveryGateway(invoke);
  expect((await gateway.list({...request(),limit:1})).nextCursor).toBe(requestId);
  invoke.mockResolvedValue({...page(),items:[]});
  expect((await gateway.list({...request(),after:requestId,limit:1})).items).toEqual([]);
  const {readingNoteId:pageId,...other}=page();
  for(const response of [{...other,pageId},{...page(),pageId},{...page(),readingNoteId:conversationId},
    {...page(),nextCursor:requestId},{...page(),items:[page().items[0],page().items[0]]},
    {...page(),items:[{...page().items[0],input:{text:"Unexpected body"}}]}]) {
    invoke.mockResolvedValue(response);await expect(gateway.list(request())).rejects.toThrow();
  }
});
it("rejects invalid scope and authority before IPC and does not retry denied discovery",async()=>{
  const invoke=vi.fn().mockRejectedValue(new Error("unbound")),gateway=createAgentReadingNoteRecoveryGateway(invoke);
  for(const input of [{...request(),limit:0},{...request(),limit:65},{...request(),after:"invalid"},
    {...request(),pageId:readingNoteId},{...request(),start:true}]) {
    await expect(gateway.list(input)).rejects.toThrow();
  }
  expect(invoke).not.toHaveBeenCalled();
  await expect(gateway.list(request())).rejects.toThrow("unbound");expect(invoke).toHaveBeenCalledOnce();
});
