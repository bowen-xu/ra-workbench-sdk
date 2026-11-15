import {expect,it,vi} from "vitest";
import type {AgentQueueEditScope,AgentQueueState,AgentSteeringHandoffIntent,AgentSteeringHandoffPage,AgentSteeringHandoffProof} from "@research-assistant/core/agent";
import {AgentSteeringHandoffController} from "./steeringHandoffController";
import {AgentSteeringHandoffRegistry} from "./steeringHandoffRegistry";
import type {AgentSteeringHandoffGateway} from "./steeringHandoff";

const conversationId="11111111-1111-4111-8111-111111111111",turnId="22222222-2222-4222-8222-222222222222",epoch="33333333-3333-4333-8333-333333333333";
const queueInputId="44444444-4444-4444-8444-444444444444",operationId="55555555-5555-4555-8555-555555555555",steeringInputId="66666666-6666-4666-8666-666666666666";
const queue:AgentQueueState={schemaVersion:1,conversationId,revision:7,paused:false,preparingInputId:null,inputs:[{inputId:queueInputId,text:"instruction"}]};
const proof=(family:AgentSteeringHandoffProof["family"]):AgentSteeringHandoffProof=>({schemaVersion:1,operationId,conversationId,family,epoch,sqlFence:"0",replayed:false,result:null});
function fixture(acceptsScope?:(scope:AgentQueueEditScope)=>boolean,captureOwner?:(scope:{conversationId:string})=>((inputId:string)=>Promise<void>)|undefined){
  let item:AgentSteeringHandoffPage["items"][number]|null=null;
  const read=vi.fn(async()=>({schemaVersion:1 as const,conversationId,epoch,items:item?[item]:[]}));
  const prepare=vi.fn(async(intent:AgentSteeringHandoffIntent)=>{item={intent,proof:proof("agent.steering.handoff.prepare"),history:"unconfirmed"};return proof("agent.steering.handoff.prepare");});
  const finish=vi.fn(async()=>{item=null;return proof("agent.steering.handoff.finish");});
  const release=vi.fn(async()=>{item=null;return proof("agent.steering.handoff.release");});
  const cancelUnregistered=vi.fn(async()=>proof("agent.steering.handoff.cancel"));
  const resolution=vi.fn(async(_intent:AgentSteeringHandoffIntent,_epoch:string):Promise<"unconfirmed"|"finished"|"released"|"canceled">=>"unconfirmed");
  const gateway:AgentSteeringHandoffGateway={read,prepare,finish,release,cancelUnregistered,resolution};
  const send=vi.fn(async(_request:{conversationId:string;turnId:string;inputId:string;text:string;userInput:AgentSteeringHandoffIntent["userInput"]},_scope:AgentQueueEditScope)=>({})); let ids=[operationId,steeringInputId];
  const owner=new AgentSteeringHandoffController(conversationId,gateway,send,()=>ids.shift()!,acceptsScope,captureOwner);
  return {owner,read,prepare,finish,release,cancelUnregistered,resolution,send,setHistory:(history:AgentSteeringHandoffPage["items"][number]["history"])=>{if(item)item={...item,history};},getItem:()=>item};
}

it.each([operationId,steeringInputId])("checks admission after the original owner flush for %s",async blockedId=>{
  let disabled=false,release!:()=>void;
  const capture=()=>async(id:string)=>{if(id===blockedId)await new Promise<void>(resolve=>{release=resolve;});};
  const f=fixture(undefined,capture);await f.owner.refresh(()=>false);
  const work=f.owner.submit(queue,turnId,queueInputId,{kind:"context"},()=>disabled);
  await vi.waitFor(()=>expect(release).toBeTypeOf("function"));disabled=true;release();
  expect(await work).toBe(false);expect(f.prepare).not.toHaveBeenCalled();expect(f.send).not.toHaveBeenCalled();
  expect(f.owner.getSnapshot()).toMatchObject({phase:"error",intent:null});
  expect(f.owner.getSnapshot().message).toContain(`operationId=${operationId}`);
  expect(f.owner.getSnapshot().message).not.toContain("instruction");f.owner.dispose();
});

it.each(["preparing","sending"] as const)("checks admission after synchronous %s listeners",async phase=>{
  let disabled=false;
  const f=fixture();await f.owner.refresh(()=>false);
  const unsubscribe=f.owner.subscribe(()=>{if(f.owner.getSnapshot().phase===phase)disabled=true;});
  expect(await f.owner.submit(queue,turnId,queueInputId,{kind:"context"},()=>disabled)).toBe(false);
  expect(f.prepare).toHaveBeenCalledTimes(phase==="preparing"?0:1);expect(f.send).not.toHaveBeenCalled();
  expect(f.owner.getSnapshot().intent===null).toBe(phase==="preparing");unsubscribe();f.owner.dispose();
});

it("retains the registered handoff when admission closes during prepare and settles it through the original terminal path",async()=>{
  let disabled=false,release!:()=>void;
  const f=fixture();await f.owner.refresh(()=>false);
  const original=f.prepare.getMockImplementation()!;
  f.prepare.mockImplementationOnce(async intent=>{const result=await original(intent);await new Promise<void>(resolve=>{release=resolve;});return result;});
  const work=f.owner.submit(queue,turnId,queueInputId,{kind:"context"},()=>disabled);
  await vi.waitFor(()=>expect(release).toBeTypeOf("function"));disabled=true;release();
  expect(await work).toBe(false);expect(f.send).not.toHaveBeenCalled();
  expect(f.owner.getSnapshot()).toMatchObject({phase:"error",intent:{operationId,steeringInputId}});
  expect(await f.owner.retry()).toBe(false);expect(f.prepare).toHaveBeenCalledOnce();expect(f.send).not.toHaveBeenCalled();
  expect(await f.owner.refresh(id=>id===turnId)).toBe(true);expect(f.release).toHaveBeenCalledOnce();
  expect(f.cancelUnregistered).not.toHaveBeenCalled();expect(f.owner.getSnapshot().intent).toBeNull();f.owner.dispose();
});

it("can replay uncertain prepare while disabled without granting the first steer",async()=>{
  let disabled=false;
  const f=fixture();await f.owner.refresh(()=>false);
  const original=f.prepare.getMockImplementation()!;
  f.prepare.mockImplementationOnce(async intent=>{await original(intent);disabled=true;throw Error("lost prepare receipt");});
  expect(await f.owner.submit(queue,turnId,queueInputId,{kind:"context"},()=>disabled)).toBe(false);
  expect(f.owner.getSnapshot().phase).toBe("uncertain");expect(await f.owner.retry()).toBe(false);
  expect(f.prepare).toHaveBeenCalledTimes(2);expect(f.prepare.mock.calls[1]).toEqual(f.prepare.mock.calls[0]);
  expect(f.send).not.toHaveBeenCalled();expect(f.owner.getSnapshot().intent).toMatchObject({operationId,steeringInputId});
  disabled=false;expect(await f.owner.retry()).toBe(true);expect(f.prepare).toHaveBeenCalledTimes(2);expect(f.send).toHaveBeenCalledOnce();f.owner.dispose();
});

it("replays only the attempted steer while disabled and finishes through confirmed history",async()=>{
  let disabled=false;
  const f=fixture();await f.owner.refresh(()=>false);
  f.send.mockImplementationOnce(async()=>{disabled=true;throw Error("lost steer receipt");});
  expect(await f.owner.submit(queue,turnId,queueInputId,{kind:"context"},()=>disabled)).toBe(false);
  expect(await f.owner.retry()).toBe(true);expect(f.prepare).toHaveBeenCalledOnce();expect(f.send).toHaveBeenCalledTimes(2);
  expect(f.send.mock.calls[1]).toEqual(f.send.mock.calls[0]);f.setHistory("confirmed");
  expect(await f.owner.refresh(()=>false)).toBe(true);expect(f.finish).toHaveBeenCalledOnce();f.owner.dispose();
});

it("persists the steering owner before handoff registration and never changes it on retry",async()=>{
  const ownerProof=vi.fn(async()=>{}), capture=vi.fn(()=>ownerProof), f=fixture(undefined,capture);
  await f.owner.refresh(()=>false);f.send.mockRejectedValueOnce(Error("lost reply"));
  expect(await f.owner.submit(queue,turnId,queueInputId)).toBe(false);
  expect(ownerProof.mock.calls).toEqual([[operationId],[steeringInputId]]);
  expect(ownerProof.mock.invocationCallOrder[0]).toBeLessThan(f.prepare.mock.invocationCallOrder[0]!);
  expect(await f.owner.retry()).toBe(true);expect(ownerProof).toHaveBeenCalledTimes(2);expect(f.send).toHaveBeenCalledTimes(2);
});
it.each([
  {kind:"manuscript",manuscriptId:epoch}, {kind:"paper",paperId:epoch},
  {kind:"note",resourceId:epoch}, {kind:"readingNote",resourceId:epoch},
] as const)("keeps the original $kind scope when a steer reply is lost",async scope=>{
  const f=fixture(()=>true);await f.owner.refresh(()=>false);
  f.send.mockRejectedValueOnce(Error("reply lost"));
  expect(await f.owner.submit(queue,turnId,queueInputId,scope)).toBe(false);
  expect(f.prepare.mock.calls[0]![0].scope).toEqual(scope);
  expect(f.send.mock.calls[0]![1]).toEqual(scope);
  expect(await f.owner.retry()).toBe(true);
  expect(f.prepare).toHaveBeenCalledOnce();
  expect(f.send.mock.calls[1]).toEqual(f.send.mock.calls[0]);
});
it("does not route a bound scope through a context-only sender",async()=>{
  const f=fixture();await f.owner.refresh(()=>false);
  expect(await f.owner.submit(queue,turnId,queueInputId,{kind:"manuscript",manuscriptId:epoch})).toBe(false);
  expect(f.prepare).not.toHaveBeenCalled();expect(f.send).not.toHaveBeenCalled();
});
it("registers frozen identities before sending and finishes only on confirmed history",async()=>{
  const f=fixture();await f.owner.refresh(()=>false);
  expect(await f.owner.submit(queue,turnId,queueInputId)).toBe(true);
  expect(f.prepare.mock.invocationCallOrder[0]).toBeLessThan(f.send.mock.invocationCallOrder[0]!);
  expect(f.prepare.mock.calls[0]![0]).toMatchObject({operationId,steeringInputId,queueInputId,expectedRevision:7,expectedEpoch:epoch});
  await f.owner.refresh(()=>false);expect(f.finish).not.toHaveBeenCalled();expect(f.owner.getSnapshot().phase).toBe("waiting");
  f.setHistory("confirmed");expect(await f.owner.refresh(()=>false)).toBe(true);
  expect(f.finish).toHaveBeenCalledOnce();expect(f.owner.getSnapshot().phase).toBe("ready");
});
it("does not claim acceptance when a refresh races the original steer receipt",async()=>{
  const f=fixture();await f.owner.refresh(()=>false);
  let reply!:()=>void;
  f.send.mockImplementationOnce(()=>new Promise(resolve=>{reply=()=>resolve({});}));
  const submission=f.owner.submit(queue,turnId,queueInputId);
  await vi.waitFor(()=>expect(f.send).toHaveBeenCalledOnce());
  await f.owner.refresh(()=>false);
  expect(f.owner.getSnapshot().phase).toBe("waiting");
  expect(f.owner.getSnapshot().acceptedOperationIds).toEqual([]);
  reply();expect(await submission).toBe(true);
  expect(f.owner.getSnapshot().acceptedOperationIds).toEqual([operationId]);
  await f.owner.refresh(()=>false);
  expect(f.owner.getSnapshot().acceptedOperationIds).toEqual([operationId]);
  f.setHistory("confirmed");await f.owner.refresh(()=>false);
  expect(f.owner.getSnapshot().acceptedOperationIds).toEqual([]);
});
it("does not infer steer acceptance from an unconfirmed registration after reattachment",async()=>{
  const f=fixture();await f.owner.refresh(()=>false);
  f.send.mockRejectedValueOnce(Error("reply lost"));
  await f.owner.submit(queue,turnId,queueInputId);
  expect(f.owner.getSnapshot().acceptedOperationIds).toEqual([]);
  f.owner.dispose();
  const recovered=new AgentSteeringHandoffController(conversationId,{read:f.read,prepare:f.prepare,finish:f.finish,release:f.release,cancelUnregistered:f.cancelUnregistered,resolution:f.resolution},f.send,()=>operationId);
  await recovered.refresh(()=>false);
  expect(recovered.getSnapshot().phase).toBe("waiting");
  expect(recovered.getSnapshot().acceptedOperationIds).toEqual([]);
  recovered.dispose();
});
it("keeps a concurrent read error visible even when the steer receipt later succeeds",async()=>{
  const f=fixture();await f.owner.refresh(()=>false);let reply!:()=>void;
  f.send.mockImplementationOnce(()=>new Promise(resolve=>{reply=()=>resolve({});}));
  const submission=f.owner.submit(queue,turnId,queueInputId);
  await vi.waitFor(()=>expect(f.send).toHaveBeenCalledOnce());
  f.read.mockRejectedValueOnce(Error("read failed"));expect(await f.owner.refresh(()=>false)).toBe(false);
  reply();expect(await submission).toBe(true);
  expect(f.owner.getSnapshot().phase).toBe("error");expect(f.owner.getSnapshot().acceptedOperationIds).toEqual([operationId]);
});
it("recognizes complete matching history as acceptance even before a lost send reply",async()=>{
  const f=fixture();await f.owner.refresh(()=>false);
  let reject!:()=>void;
  f.send.mockImplementationOnce(()=>new Promise((_resolve,fail)=>{reject=()=>fail(Error("reply lost"));}));
  const submission=f.owner.submit(queue,turnId,queueInputId);
  await vi.waitFor(()=>expect(f.send).toHaveBeenCalledOnce());
  f.setHistory("confirmed");let finish!:()=>void;const finishReal=f.finish.getMockImplementation()!;
  f.finish.mockImplementationOnce(()=>new Promise(resolve=>{finish=()=>{void finishReal().then(resolve);};}));
  const refreshing=f.owner.refresh(()=>false);
  await vi.waitFor(()=>expect(f.finish).toHaveBeenCalledOnce());
  expect(f.owner.getSnapshot().acceptedOperationIds).toEqual([operationId]);
  reject();expect(await submission).toBe(false);
  finish();await refreshing;
  expect(f.owner.getSnapshot().acceptedOperationIds).toEqual([]);
});
it("retries the same uncertain registration and send without changing identities",async()=>{
  const f=fixture();await f.owner.refresh(()=>false);
  const real=f.prepare.getMockImplementation()!;f.prepare.mockImplementationOnce(async intent=>{await real(intent);throw Error("lost receipt");});
  expect(await f.owner.submit(queue,turnId,queueInputId)).toBe(false);expect(f.send).not.toHaveBeenCalled();
  expect(await f.owner.retry()).toBe(true);expect(f.prepare.mock.calls[1]).toEqual(f.prepare.mock.calls[0]);
  expect(f.send.mock.calls[0]![0]).toMatchObject({turnId,inputId:steeringInputId,text:"instruction"});
});
it("discovers after restart and never resends; an absent history requires terminal evidence",async()=>{
  const f=fixture();await f.owner.refresh(()=>false);await f.owner.submit(queue,turnId,queueInputId);
  f.owner.dispose();const recovered=new AgentSteeringHandoffController(conversationId,{read:f.read,prepare:f.prepare,finish:f.finish,release:f.release,cancelUnregistered:f.cancelUnregistered,resolution:f.resolution},f.send,()=>operationId);
  await recovered.refresh(()=>false);expect(f.release).not.toHaveBeenCalled();expect(recovered.getSnapshot().phase).toBe("waiting");
  await recovered.refresh(id=>id===turnId);expect(f.release).toHaveBeenCalledOnce();expect(f.send).toHaveBeenCalledOnce();expect(recovered.getSnapshot().phase).toBe("ready");
});
it("retries the exact resolution after a committed response is lost",async()=>{
  const f=fixture();await f.owner.refresh(()=>false);await f.owner.submit(queue,turnId,queueInputId);f.setHistory("confirmed");
  const real=f.finish.getMockImplementation()!;f.finish.mockImplementationOnce(async()=>{await real();throw Error("lost receipt");});
  expect(await f.owner.refresh(()=>false)).toBe(false);expect(f.owner.getSnapshot().phase).toBe("error");
  expect(await f.owner.refresh(()=>false)).toBe(true);expect(f.finish).toHaveBeenCalledTimes(2);expect(f.finish.mock.calls[1]).toEqual(f.finish.mock.calls[0]);
});
it("does not infer failure from a missing record after an uncertain registration",async()=>{
  const f=fixture();await f.owner.refresh(()=>false);f.prepare.mockRejectedValueOnce(Error("unknown"));
  await f.owner.submit(queue,turnId,queueInputId);await f.owner.refresh(()=>false);
  expect(f.owner.getSnapshot().phase).toBe("uncertain");expect(f.owner.getSnapshot().intent?.operationId).toBe(operationId);
  expect(f.release).not.toHaveBeenCalled();expect(f.send).not.toHaveBeenCalled();
});
it("fences a missing uncertain registration only after the original turn ends",async()=>{
  const f=fixture();await f.owner.refresh(()=>false);f.prepare.mockRejectedValueOnce(Error("unknown"));
  await f.owner.submit(queue,turnId,queueInputId);
  expect(await f.owner.refresh(()=>true)).toBe(true);
  expect(f.cancelUnregistered).toHaveBeenCalledWith(expect.objectContaining({operationId,steeringInputId,queueInputId}),epoch);
  expect(f.send).not.toHaveBeenCalled();expect(f.owner.getSnapshot().phase).toBe("ready");
});
it.each(["finished","released"] as const)("recognizes a handoff %s by another window only from its receipt",async status=>{
  const f=fixture();await f.owner.refresh(()=>false);await f.owner.submit(queue,turnId,queueInputId);
  await f.finish(); // Simulate a separate window resolving the shared record.
  expect(await f.owner.refresh(()=>true)).toBe(false);
  expect(f.owner.getSnapshot().phase).toBe("uncertain");
  f.resolution.mockResolvedValueOnce(status);
  expect(await f.owner.refresh(()=>true)).toBe(true);
  expect(f.owner.getSnapshot().phase).toBe("ready");expect(f.send).toHaveBeenCalledOnce();
});
it("checks a different window's resolution before retrying a lost resolution",async()=>{
  const f=fixture();await f.owner.refresh(()=>false);await f.owner.submit(queue,turnId,queueInputId);
  f.setHistory("confirmed");f.finish.mockRejectedValueOnce(Error("lost receipt"));
  expect(await f.owner.refresh(()=>false)).toBe(false);
  await f.release();f.resolution.mockResolvedValueOnce("released");
  expect(await f.owner.refresh(()=>false)).toBe(true);
  expect(f.finish).toHaveBeenCalledOnce();expect(f.send).toHaveBeenCalledOnce();
});
it("retains a confirmed registration if a contradictory cancellation proof appears",async()=>{
  const f=fixture();await f.owner.refresh(()=>false);await f.owner.submit(queue,turnId,queueInputId);
  await f.finish();f.resolution.mockResolvedValueOnce("canceled");
  expect(await f.owner.refresh(()=>true)).toBe(false);
  expect(f.owner.getSnapshot().intent?.operationId).toBe(operationId);
});
it("retries the same cancellation after a lost cancellation receipt",async()=>{
  const f=fixture();await f.owner.refresh(()=>false);f.prepare.mockRejectedValueOnce(Error("unknown"));
  await f.owner.submit(queue,turnId,queueInputId);
  f.cancelUnregistered.mockRejectedValueOnce(Error("lost receipt"));
  expect(await f.owner.refresh(()=>true)).toBe(false);
  expect(await f.owner.refresh(()=>true)).toBe(true);
  expect(f.cancelUnregistered.mock.calls[1]).toEqual(f.cancelUnregistered.mock.calls[0]);expect(f.send).not.toHaveBeenCalled();
});
it("discovers a registration that wins the race against cancellation",async()=>{
  const f=fixture();await f.owner.refresh(()=>false);const register=f.prepare.getMockImplementation()!;
  f.prepare.mockRejectedValueOnce(Error("unknown"));await f.owner.submit(queue,turnId,queueInputId);
  f.cancelUnregistered.mockImplementationOnce(async()=>{await register(f.owner.getSnapshot().intent!);throw {code:"DATA_SQL_OPERATION_CONFLICT",reason:{safeCause:"handoff_already_registered"}};});
  expect(await f.owner.refresh(()=>true)).toBe(false);
  expect(await f.owner.refresh(()=>true)).toBe(true);
  expect(f.cancelUnregistered).toHaveBeenCalledOnce();expect(f.release).toHaveBeenCalledOnce();expect(f.send).not.toHaveBeenCalled();
});
it("keeps partial or conflicting history unresolved even when the turn is terminal",async()=>{
  const f=fixture();await f.owner.refresh(()=>false);await f.owner.submit(queue,turnId,queueInputId);f.setHistory("incompleteOrConflicting");
  expect(await f.owner.refresh(()=>true)).toBe(false);expect(f.finish).not.toHaveBeenCalled();expect(f.release).not.toHaveBeenCalled();
  expect(f.owner.getSnapshot().phase).toBe("waiting");
});
it("finishes from history while the original steer reply is still pending",async()=>{
  const f=fixture();await f.owner.refresh(()=>false);
  let reply!:()=>void;
  f.send.mockImplementationOnce(()=>new Promise(resolve=>{reply=()=>resolve({});}));
  const submission=f.owner.submit(queue,turnId,queueInputId);
  await vi.waitFor(()=>expect(f.send).toHaveBeenCalledOnce());f.setHistory("confirmed");
  expect(await f.owner.refresh(()=>false)).toBe(true);expect(f.finish).toHaveBeenCalledOnce();
  reply();expect(await submission).toBe(true);expect(f.owner.getSnapshot().phase).toBe("ready");
});
it("keeps a pending owner across view detach and reattaches the same identity",async()=>{
  const f=fixture();let reply!:()=>void;
  f.send.mockImplementationOnce(()=>new Promise(resolve=>{reply=()=>resolve({});}));
  const ids=[operationId,steeringInputId];
  const registry=new AgentSteeringHandoffRegistry({read:f.read,prepare:f.prepare,finish:f.finish,release:f.release,cancelUnregistered:f.cancelUnregistered,resolution:f.resolution},f.send,()=>ids.shift()!);
  const root=registry.retain(),first=registry.acquire(conversationId)!;
  await first.controller.refresh(()=>false);
  const send=first.controller.submit(queue,turnId,queueInputId);
  await vi.waitFor(()=>expect(f.send).toHaveBeenCalledOnce());first.release();
  const second=registry.acquire(conversationId)!;expect(second.controller).toBe(first.controller);
  f.setHistory("confirmed");await second.controller.refresh(()=>false);reply();await send;
  expect(second.controller.getSnapshot().phase).toBe("ready");expect(f.send).toHaveBeenCalledOnce();
  second.release();root();
});
