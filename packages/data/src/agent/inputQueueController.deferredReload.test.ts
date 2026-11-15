import {expect,it,vi} from "vitest";
import type {AgentQueueState} from "@research-assistant/core/agent";
import {AgentInputQueueController} from "./inputQueueController";

const scope={conversationId:"conversation"};
const initial:AgentQueueState={schemaVersion:1,conversationId:"conversation",revision:0,paused:false,preparingInputId:null,inputs:[]};
const added:AgentQueueState={...initial,revision:1,inputs:[{inputId:"input",text:"message"}]};
const finished:AgentQueueState={...added,revision:2};
const edit={type:"add" as const,inputId:"input",text:"message"};

it("coalesces reads requested during an edit and applies the post-edit snapshot",async()=>{
  let release!:(value:AgentQueueState)=>void;
  const read=vi.fn().mockResolvedValueOnce(initial).mockResolvedValueOnce(finished);
  const write=vi.fn(()=>new Promise<AgentQueueState>(resolve=>{release=resolve;}));
  const owner=new AgentInputQueueController({read,edit:write},scope,()=>"request");
  await owner.reload();const changed=owner.edit(edit);const first=owner.reload(),second=owner.reload();
  expect(read).toHaveBeenCalledTimes(1);
  release(added);expect(await changed).toBe(true);await Promise.all([first,second]);
  expect(read).toHaveBeenCalledTimes(2);expect(read.mock.calls[1]?.[0]).toEqual(scope);
  expect(owner.getSnapshot().queue).toEqual(finished);expect(owner.getSnapshot().readSequence).toBe(2);
  owner.dispose();
});

it("preserves an edit rejection while a deferred read refreshes the queue",async()=>{
  let reject!:(reason:unknown)=>void;
  const read=vi.fn().mockResolvedValueOnce(initial).mockResolvedValue(finished);
  const write=vi.fn(()=>new Promise<AgentQueueState>((_resolve,fail)=>{reject=fail;}));
  const owner=new AgentInputQueueController({read,edit:write},scope,()=>"request");
  await owner.reload();const changed=owner.edit(edit);const refresh=owner.reload();
  reject({code:"conflict"});expect(await changed).toBe(false);await refresh;
  expect(owner.getSnapshot()).toMatchObject({queue:finished,error:"队列操作未应用，消息已保留。",uncertain:false,pending:false});
  owner.dispose();
});

it("preserves an unresolved write and its original request while refreshing",async()=>{
  const read=vi.fn().mockResolvedValue(initial);
  const write=vi.fn().mockRejectedValue(Error("lost receipt"));
  const owner=new AgentInputQueueController({read,edit:write},scope,()=>"request");
  await owner.reload();const changed=owner.edit(edit);const refresh=owner.reload();
  expect(await changed).toBe(false);await refresh;
  expect(owner.getSnapshot()).toMatchObject({uncertain:true,pending:true,error:expect.stringContaining("队列暂时无法同步")});
  expect(owner.getPendingRequest()).toMatchObject({requestId:"request",expectedRevision:0,edit});
  owner.dispose();
});

it("settles deferred waiters on disposal without starting another read",async()=>{
  let release!:(value:AgentQueueState)=>void;
  const read=vi.fn().mockResolvedValue(initial);
  const write=vi.fn(()=>new Promise<AgentQueueState>(resolve=>{release=resolve;}));
  const owner=new AgentInputQueueController({read,edit:write},scope,()=>"request");
  await owner.reload();const changed=owner.edit(edit);const refresh=owner.reload();
  owner.dispose();await refresh;release(added);expect(await changed).toBe(false);expect(read).toHaveBeenCalledOnce();
});
