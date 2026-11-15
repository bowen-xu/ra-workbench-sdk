import {expect,it,vi} from "vitest";
import type {AgentQueueCommand,AgentQueueState} from "@research-assistant/core/agent";
import {AgentInputQueueController} from "./inputQueueController";

const scope={conversationId:"conversation"};
const initial:AgentQueueState={schemaVersion:1,conversationId:scope.conversationId,revision:4,paused:false,preparingInputId:null,
  inputs:[{inputId:"transferring",text:"first"}]};
const afterHandoff:AgentQueueState={...initial,revision:5,inputs:[]};
const afterAdd:AgentQueueState={...afterHandoff,revision:6,inputs:[{inputId:"new",text:"second"}]};
const add={type:"add" as const,inputId:"new",text:"second",userInput:[]};

it("rebases one definitively rejected append after handoff has advanced the revision",async()=>{
  const read=vi.fn().mockResolvedValueOnce(initial).mockResolvedValueOnce(afterHandoff);
  const requests:AgentQueueCommand[]=[];
  const write=vi.fn(async(request:AgentQueueCommand)=>{requests.push(structuredClone(request));if(requests.length===1)throw {code:"conflict"};return afterAdd;});
  const ids=["old-request","new-request"],owner=new AgentInputQueueController({read,edit:write},scope,()=>ids.shift()!);
  const acknowledge=vi.fn();await owner.reload();expect(await owner.edit(add,acknowledge)).toBe(true);
  expect(requests).toEqual([{...scope,requestId:"old-request",expectedRevision:4,edit:add},{...scope,requestId:"new-request",expectedRevision:5,edit:add}]);
  expect(acknowledge).toHaveBeenCalledOnce();expect(owner.getSnapshot().queue).toEqual(afterAdd);owner.dispose();
});

it("freezes both the original and rebased request under the owner captured at edit creation", async () => {
  const read=vi.fn().mockResolvedValueOnce(initial).mockResolvedValueOnce(afterHandoff);
  const steps:string[]=[]; let currentOwner="old-scene";
  const capture=vi.fn(()=>{const frozen=currentOwner;return async (id:string)=>{steps.push(`freeze:${id}:${frozen}`);};});
  const write=vi.fn(async(request:AgentQueueCommand)=>{steps.push(`send:${request.requestId}`);if(request.requestId==="old-request"){currentOwner="new-scene";throw {code:"conflict"};}return afterAdd;});
  const ids=["old-request","new-request"], owner=new AgentInputQueueController({read,edit:write},scope,()=>ids.shift()!,capture);
  await owner.reload(); expect(await owner.edit(add)).toBe(true);
  expect(steps).toEqual(["freeze:old-request:old-scene","send:old-request","freeze:new-request:old-scene","send:new-request"]);
  expect(capture).toHaveBeenCalledOnce();owner.dispose();
});

it("does not send before both captured owner and existing beforeSend are durable", async () => {
  const read=vi.fn().mockResolvedValue(initial), write=vi.fn().mockResolvedValue(afterAdd);
  let fail=true;const prepare=vi.fn(async()=>{if(fail)throw new Error("offline");});
  const prior=vi.fn(async()=>{}), owner=new AgentInputQueueController({read,edit:write},scope,()=>"request",()=>prepare);
  await owner.reload();expect(await owner.edit(add,undefined,prior)).toBe(false);
  expect(write).not.toHaveBeenCalled();expect(prior).not.toHaveBeenCalled();
  fail=false;expect(await owner.retry()).toBe(true);expect(prior).toHaveBeenCalledOnce();expect(write).toHaveBeenCalledOnce();owner.dispose();
});

it("accepts an append that commits before the handoff without reissuing it",async()=>{
  let finish!:(value:AgentQueueState)=>void;
  const read=vi.fn().mockResolvedValueOnce(initial).mockResolvedValueOnce(afterAdd);
  const write=vi.fn(()=>new Promise<AgentQueueState>(resolve=>{finish=resolve;}));
  const ids=vi.fn(()=>"request"),owner=new AgentInputQueueController({read,edit:write},scope,ids);
  const acknowledge=vi.fn();await owner.reload();const work=owner.edit(add,acknowledge);const refresh=owner.reload();
  finish({...initial,revision:5,inputs:[...initial.inputs,afterAdd.inputs[0]!]});
  expect(await work).toBe(true);await refresh;
  expect(write).toHaveBeenCalledOnce();expect(ids).toHaveBeenCalledOnce();expect(acknowledge).toHaveBeenCalledOnce();
  expect(owner.getSnapshot().queue).toEqual(afterAdd);owner.dispose();
});

it("never changes identity after an ambiguous reply, even if a later retry conflicts",async()=>{
  const read=vi.fn().mockResolvedValueOnce(initial).mockResolvedValue(afterHandoff);
  const write=vi.fn().mockRejectedValueOnce(Error("lost reply")).mockRejectedValueOnce({code:"conflict"});
  const ids=vi.fn(()=>"original-request"),owner=new AgentInputQueueController({read,edit:write},scope,ids);
  const acknowledge=vi.fn();await owner.reload();expect(await owner.edit(add,acknowledge)).toBe(false);
  expect(write).toHaveBeenCalledTimes(2);expect(write.mock.calls[1]).toEqual(write.mock.calls[0]);expect(ids).toHaveBeenCalledOnce();
  expect(acknowledge).not.toHaveBeenCalled();expect(owner.getSnapshot().uncertain).toBe(true);
  expect(owner.getPendingRequest()).toMatchObject({requestId:"original-request",expectedRevision:4,edit:add});owner.dispose();
});

it("retains the rebased identity if its reply is lost",async()=>{
  const read=vi.fn().mockResolvedValueOnce(initial).mockResolvedValue(afterHandoff);
  const write=vi.fn().mockRejectedValueOnce({code:"conflict"}).mockRejectedValueOnce(Error("lost reply")).mockResolvedValueOnce(afterAdd);
  const ids=vi.fn().mockReturnValueOnce("old-request").mockReturnValueOnce("rebased-request");
  const owner=new AgentInputQueueController({read,edit:write},scope,ids),acknowledge=vi.fn();
  await owner.reload();expect(await owner.edit(add,acknowledge)).toBe(true);
  expect(ids).toHaveBeenCalledTimes(2);expect(write).toHaveBeenCalledTimes(3);
  expect(write.mock.calls[2]).toEqual(write.mock.calls[1]);
  expect(write.mock.calls[1]?.[0]).toMatchObject({requestId:"rebased-request",expectedRevision:5,edit:add});
  expect(acknowledge).toHaveBeenCalledOnce();owner.dispose();
});

it("stops after a rebased append encounters another conflict",async()=>{
  const read=vi.fn().mockResolvedValueOnce(initial).mockResolvedValue(afterHandoff);
  const write=vi.fn().mockRejectedValue({code:"conflict"});
  const ids=vi.fn().mockReturnValueOnce("old-request").mockReturnValueOnce("rebased-request");
  const owner=new AgentInputQueueController({read,edit:write},scope,ids),acknowledge=vi.fn();
  await owner.reload();expect(await owner.edit(add,acknowledge)).toBe(false);
  expect(write).toHaveBeenCalledTimes(2);expect(ids).toHaveBeenCalledTimes(2);expect(acknowledge).not.toHaveBeenCalled();
  expect(owner.getSnapshot().error).toContain("消息已保留");owner.dispose();
});

it("never rebases a write owned by a durable beforeSend callback",async()=>{
  const read=vi.fn().mockResolvedValueOnce(initial).mockResolvedValue(afterHandoff);
  const write=vi.fn().mockRejectedValue({code:"conflict"});
  const ids=vi.fn(()=>"original-request"),owner=new AgentInputQueueController({read,edit:write},scope,ids);
  const acknowledge=vi.fn(),beforeSend=vi.fn(async()=>{});await owner.reload();
  expect(await owner.edit(add,acknowledge,beforeSend)).toBe(false);
  expect(beforeSend).toHaveBeenCalledOnce();expect(write).toHaveBeenCalledOnce();expect(ids).toHaveBeenCalledOnce();
  expect(acknowledge).not.toHaveBeenCalled();owner.dispose();
});

it.each([
  {name:"unchanged revision",snapshot:initial},
  {name:"other conversation",snapshot:{...afterHandoff,conversationId:"other"}},
  {name:"input already exists",snapshot:{...afterHandoff,inputs:[{inputId:"new",text:"second"}]}},
])("does not rebase without the required proof: $name",async({snapshot})=>{
  const read=vi.fn().mockResolvedValueOnce(initial).mockResolvedValue(snapshot);
  const write=vi.fn().mockRejectedValue({code:"conflict"});
  const ids=vi.fn(()=>"original-request"),owner=new AgentInputQueueController({read,edit:write},scope,ids);
  const acknowledge=vi.fn();await owner.reload();expect(await owner.edit(add,acknowledge)).toBe(false);
  expect(write).toHaveBeenCalledOnce();expect(ids).toHaveBeenCalledOnce();expect(acknowledge).not.toHaveBeenCalled();
  expect(owner.getSnapshot().error).toContain("消息已保留");
  expect(owner.getSnapshot().queue?.conversationId).toBe(scope.conversationId);owner.dispose();
});
