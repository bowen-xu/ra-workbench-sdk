import {expect,it,vi} from "vitest";
import type {AgentQueueState,AgentSteeringHandoffIntent,AgentSteeringHandoffPage,AgentSteeringHandoffProof} from "@research-assistant/core/agent";
import type {AgentSteeringHandoffGateway} from "./steeringHandoff";
import {AgentSteeringHandoffController} from "./steeringHandoffController";

const conversationId="11111111-1111-4111-8111-111111111111",turnId="22222222-2222-4222-8222-222222222222",epoch="33333333-3333-4333-8333-333333333333";
const first="44444444-4444-4444-8444-444444444444",second="77777777-7777-4777-8777-777777777777";
const queue:AgentQueueState={schemaVersion:1,conversationId,revision:7,paused:false,preparingInputId:null,inputs:[{inputId:first,text:"first"},{inputId:second,text:"second"}]};
type Item=AgentSteeringHandoffPage["items"][number];
function fixture(){
  const saved=new Map<string,Item>();
  const proof=(intent:AgentSteeringHandoffIntent,family:AgentSteeringHandoffProof["family"]):AgentSteeringHandoffProof=>({schemaVersion:1,operationId:intent.operationId,conversationId,family,epoch,sqlFence:"0",replayed:false,result:null});
  const gateway:AgentSteeringHandoffGateway={
    read:vi.fn(async()=>({schemaVersion:1 as const,conversationId,epoch,items:[...saved.values()]})),
    prepare:vi.fn(async intent=>{const receipt=proof(intent,"agent.steering.handoff.prepare");saved.set(intent.operationId,{intent,proof:receipt,history:"unconfirmed"});return receipt;}),
    finish:vi.fn(async intent=>{saved.delete(intent.operationId);return proof(intent,"agent.steering.handoff.finish");}),
    release:vi.fn(async intent=>{saved.delete(intent.operationId);return proof(intent,"agent.steering.handoff.release");}),
    cancelUnregistered:vi.fn(async intent=>proof(intent,"agent.steering.handoff.cancel")),
    resolution:vi.fn(async():Promise<"unconfirmed"|"finished"|"released"|"canceled">=>"unconfirmed"),
  };
  const send=vi.fn(async(_request:{conversationId:string;turnId:string;inputId:string;text:string;userInput:AgentSteeringHandoffIntent["userInput"]})=>({}));
  const owner=new AgentSteeringHandoffController(conversationId,gateway,send,()=>crypto.randomUUID());
  function confirm(index:number){const item=[...saved.values()][index];if(!item)throw new Error("missing handoff");saved.set(item.intent.operationId,{...item,history:"confirmed"});}
  return {owner,gateway,send,saved,confirm};
}

it("accepts two distinct queued inputs in click order while both await one model boundary",async()=>{
  const f=fixture();await f.owner.refresh(()=>false);
  expect(await f.owner.submit(queue,turnId,first)).toBe(true);
  expect(f.owner.canSubmit(turnId)).toBe(false); // registration has not yet been re-read
  await f.owner.refresh(()=>false);
  expect(f.owner.canSubmit(turnId)).toBe(true);
  expect(f.owner.canSubmit("88888888-8888-4888-8888-888888888888")).toBe(false);
  expect(await f.owner.submit(queue,turnId,second)).toBe(true);
  await f.owner.refresh(()=>false);
  expect(f.send.mock.calls.map(([request])=>request.text)).toEqual(["first","second"]);
  expect(f.owner.getSnapshot().items.map(item=>item.intent.text)).toEqual(["first","second"]);
  expect(f.owner.getSnapshot().acceptedOperationIds).toEqual(f.owner.getSnapshot().items.map(item=>item.intent.operationId));
  expect(await f.owner.submit(queue,turnId,first)).toBe(false);
  f.confirm(0);f.confirm(1);expect(await f.owner.refresh(()=>false)).toBe(true);
  expect(f.gateway.finish).toHaveBeenCalledTimes(2);expect(f.owner.getSnapshot().phase).toBe("ready");
});

it("does not infer acceptance from previously registered handoffs after reattachment",async()=>{
  const f=fixture();await f.owner.refresh(()=>false);await f.owner.submit(queue,turnId,first);await f.owner.refresh(()=>false);
  const reopened=new AgentSteeringHandoffController(conversationId,f.gateway,f.send,()=>crypto.randomUUID());
  await reopened.refresh(()=>false);
  expect(reopened.getSnapshot().items).toHaveLength(1);
  expect(reopened.canSubmit(turnId)).toBe(false);
  expect(await reopened.submit(queue,turnId,second)).toBe(false);
  expect(f.send).toHaveBeenCalledOnce();
});

it("settles consumed and unconsumed items independently after the original turn ends",async()=>{
  const f=fixture();await f.owner.refresh(()=>false);await f.owner.submit(queue,turnId,first);await f.owner.refresh(()=>false);
  await f.owner.submit(queue,turnId,second);await f.owner.refresh(()=>false);
  f.confirm(0);
  expect(await f.owner.refresh(id=>id===turnId)).toBe(true);
  expect(f.gateway.finish).toHaveBeenCalledTimes(1);
  expect(f.gateway.release).toHaveBeenCalledTimes(1);
  expect(f.gateway.finish).toHaveBeenCalledWith(expect.objectContaining({queueInputId:first}),epoch);
  expect(f.gateway.release).toHaveBeenCalledWith(expect.objectContaining({queueInputId:second}),epoch);
});

it("reports a partial settlement and accepts a third item against the refreshed queue",async()=>{
  const f=fixture();await f.owner.refresh(()=>false);await f.owner.submit(queue,turnId,first);await f.owner.refresh(()=>false);
  await f.owner.submit(queue,turnId,second);await f.owner.refresh(()=>false);
  const notices:boolean[]=[];const unsubscribe=f.owner.subscribe(()=>notices.push(f.owner.canSubmit(turnId)));
  f.confirm(0);expect(await f.owner.refresh(()=>false)).toBe(false);
  expect(f.owner.getSnapshot().settledSequence).toBe(1);
  expect(f.owner.getSnapshot().items.map(item=>item.intent.text)).toEqual(["second"]);
  expect(notices.at(-1)).toBe(true);
  const third="99999999-9999-4999-8999-999999999999";
  const updated:AgentQueueState={...queue,revision:8,inputs:[queue.inputs[1]!,{inputId:third,text:"third"}]};
  expect(await f.owner.submit(updated,turnId,third)).toBe(true);
  await f.owner.refresh(()=>false);
  expect(f.send.mock.calls.map(([request])=>request.text)).toEqual(["first","second","third"]);
  expect(f.owner.getSnapshot().items.map(item=>item.intent.text)).toEqual(["second","third"]);
  unsubscribe();
});

it("resolves a lost partial-finish receipt without repeating the completed operation",async()=>{
  const f=fixture();await f.owner.refresh(()=>false);await f.owner.submit(queue,turnId,first);await f.owner.refresh(()=>false);
  await f.owner.submit(queue,turnId,second);await f.owner.refresh(()=>false);f.confirm(0);
  const finish=vi.mocked(f.gateway.finish);const original=finish.getMockImplementation()!;
  finish.mockImplementationOnce(async(intent,expectedEpoch)=>{await original(intent,expectedEpoch);throw Error("lost finish receipt");});
  expect(await f.owner.refresh(()=>false)).toBe(false);
  expect(f.owner.getSnapshot().phase).toBe("error");
  expect(f.owner.getSnapshot().settledSequence).toBe(0);
  vi.mocked(f.gateway.resolution).mockResolvedValueOnce("finished");
  expect(await f.owner.refresh(()=>false)).toBe(false);
  expect(finish).toHaveBeenCalledTimes(1);
  expect(f.owner.getSnapshot().settledSequence).toBe(1);
  expect(f.owner.getSnapshot().items.map(item=>item.intent.text)).toEqual(["second"]);
  expect(f.owner.canSubmit(turnId)).toBe(true);
});

it("keeps an older accepted handoff while retrying only the later unknown send",async()=>{
  const f=fixture();await f.owner.refresh(()=>false);await f.owner.submit(queue,turnId,first);await f.owner.refresh(()=>false);
  f.send.mockRejectedValueOnce(Error("lost response"));
  expect(await f.owner.submit(queue,turnId,second)).toBe(false);
  expect(f.owner.getSnapshot().phase).toBe("uncertain");
  expect(f.owner.canSubmit(turnId)).toBe(false);
  f.confirm(0);expect(await f.owner.refresh(()=>false)).toBe(false);
  expect(f.gateway.finish).toHaveBeenCalledTimes(1);
  expect(f.owner.getSnapshot().phase).toBe("uncertain");
  expect(await f.owner.retry()).toBe(true);
  expect(f.send.mock.calls.map(([request])=>request.text)).toEqual(["first","second","second"]);
  expect(f.send.mock.calls[1]?.[0]).toEqual(f.send.mock.calls[2]?.[0]);
  await f.owner.refresh(()=>false);expect(f.owner.getSnapshot().items.map(item=>item.intent.text)).toEqual(["second"]);
});

it("does not replace an in-flight newer send when an older handoff confirms",async()=>{
  const f=fixture();await f.owner.refresh(()=>false);await f.owner.submit(queue,turnId,first);await f.owner.refresh(()=>false);
  let reply!:()=>void;f.send.mockImplementationOnce(()=>new Promise(resolve=>{reply=()=>resolve({});}));
  const submission=f.owner.submit(queue,turnId,second);
  await vi.waitFor(()=>expect(f.send).toHaveBeenCalledTimes(2));
  const operation=f.owner.getSnapshot().intent?.operationId;
  f.confirm(0);await f.owner.refresh(()=>false);
  expect(f.owner.getSnapshot().intent?.operationId).toBe(operation);
  reply();expect(await submission).toBe(true);
  expect(f.owner.getSnapshot().acceptedOperationIds).toContain(operation);
  await f.owner.refresh(()=>false);expect(f.owner.getSnapshot().items.map(item=>item.intent.text)).toEqual(["second"]);
});
