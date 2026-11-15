import { expect, it, vi } from "vitest";
import { AgentNoteReviewDecodeError, decodeAgentNoteRewriteReview } from "@research-assistant/core/agent";
import { createAgentNoteReviewGateway } from "./noteReview";

const scope={conversationId:"a1111111-1111-4111-8111-111111111111",pageId:"b1111111-1111-4111-8111-111111111111",turnId:"c1111111-1111-4111-8111-111111111111",itemId:"d1111111-1111-4111-8111-111111111111"};
function fixture() {
  const content=(text:string)=>({kind:"inline",items:[{type:"text",text,styles:["bold"]},
    {type:"mention",targetKind:"paper",targetId:"paper-1",labelSnapshot:"Evidence"}]});
  return {schemaVersion:1,scope:{...scope},currentRevision:4,baselineMatches:true,proposal:{
    schemaVersion:1,kind:"noteInlineRewrite",status:"proposed",proposalId:`note-rewrite:${"a".repeat(64)}`,
    conversationId:scope.conversationId,turnId:scope.turnId,pageId:scope.pageId,
    contextSnapshotId:"e1111111-1111-4111-8111-111111111111",sourceId:`note:${"b".repeat(64)}`,
    revision:`revision:4:sha256:${"c".repeat(64)}`,anchor:JSON.stringify({schemaVersion:1,pageId:scope.pageId,pageRevision:4,blockId:"parent"}),
    edits:[{blockId:"nested",before:content("Before 中文"),after:content("After 中文")}],
  }};
}

it("reviews only the captured scope and preserves a structured independent result",async()=>{
  let resolve!:(value:unknown)=>void;
  const response=fixture();
  const invoke=vi.fn(()=>new Promise(resolveValue=>{resolve=resolveValue;}));
  const request={...scope};
  const pending=createAgentNoteReviewGateway(invoke).review(request);
  request.pageId="ffffffff-ffff-4fff-8fff-ffffffffffff";
  expect(invoke).toHaveBeenCalledWith("agent_review_note_rewrite",{request:scope});
  resolve(response);
  const review=await pending;
  expect(review.proposal.edits[0]?.after.items).toEqual(response.proposal.edits[0]?.after.items);
  response.proposal.edits[0]!.after.items[0]!.text="mutated";
  expect(review.proposal.edits[0]?.after.items[0]).toMatchObject({text:"After 中文"});
  expect(review.scope.pageId).toBe(scope.pageId);
});

it("accepts a changed saved revision only as a conflict and never rebases the proposal",()=>{
  const response=fixture();response.currentRevision=5;response.baselineMatches=false;
  const review=decodeAgentNoteRewriteReview(response,scope);
  expect(review.proposal.revision).toContain("revision:4:");
  expect(review.baselineMatches).toBe(false);
  response.baselineMatches=true;
  expect(()=>decodeAgentNoteRewriteReview(response,scope)).toThrow(AgentNoteReviewDecodeError);
});

it("rejects forged scopes, states, versions, duplicate edits, malformed or lossy content",()=>{
  const changes:Array<(r:ReturnType<typeof fixture>)=>void>=[
    r=>{r.scope.itemId="ffffffff-ffff-4fff-8fff-ffffffffffff";},
    r=>{r.proposal.pageId="ffffffff-ffff-4fff-8fff-ffffffffffff";},
    r=>{r.proposal.status="applied";},
    r=>{r.proposal.proposalId="guessed";},
    r=>{r.proposal.contextSnapshotId="invalid";},
    r=>{r.proposal.anchor=JSON.stringify({schemaVersion:1,pageId:scope.pageId,pageRevision:5,blockId:null});},
    r=>{r.currentRevision=Number.MAX_SAFE_INTEGER+1;},
    r=>{r.proposal.edits.push(r.proposal.edits[0]!);},
    r=>{r.proposal.edits[0]!.after=r.proposal.edits[0]!.before;},
    r=>{r.proposal.edits[0]!.after.items.pop();},
    r=>{Object.assign(r.proposal.edits[0]!.after,{unknown:true});},
    r=>{Object.assign(r.proposal.edits[0]!.after.items[0]!,{unknown:true});},
    r=>{r.proposal.edits[0]!.after.items[0]!.styles=["unknown"];},
    r=>{r.proposal.edits[0]!.after.items[0]!.text="x".repeat(128*1024);},
  ];
  for(const change of changes){const response=fixture();change(response);expect(()=>decodeAgentNoteRewriteReview(response,scope)).toThrow(AgentNoteReviewDecodeError);}
});

it("rejects renderer edit authority before IPC and propagates failures without automatic retry",async()=>{
  const invoke=vi.fn().mockRejectedValue(new Error("unavailable"));
  const gateway=createAgentNoteReviewGateway(invoke);
  await expect(gateway.review({...scope,after:{}} as typeof scope)).rejects.toThrow(AgentNoteReviewDecodeError);
  expect(invoke).not.toHaveBeenCalled();
  await expect(gateway.review(scope)).rejects.toThrow("unavailable");
  expect(invoke).toHaveBeenCalledTimes(1);
});
