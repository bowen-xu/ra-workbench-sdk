import {expect, it, vi} from "vitest";
import {decodeAgentSteeringHandoffIntent, type AgentQueueState, type AgentSteeringHandoffIntent,
  type AgentSteeringHandoffProof, type AgentWritingSteerRequest} from "@research-assistant/core/agent";
import {createAgentSteeringGateway} from "./submission";
import {createAgentSteeringHandoffGateway, agentSteeringHandoffResolvedId} from "./steeringHandoff";
import {AgentSteeringHandoffController} from "./steeringHandoffController";

const conversationId="11111111-1111-4111-8111-111111111111",turnId="22222222-2222-4222-8222-222222222222";
const epoch="33333333-3333-4333-8333-333333333333",queueInputId="44444444-4444-4444-8444-444444444444";
const operationId="55555555-5555-4555-8555-555555555555",steeringInputId="66666666-6666-4666-8666-666666666666";
const foreign="77777777-7777-4777-8777-777777777777",scope={kind:"manuscript" as const,manuscriptId:foreign};
const queue:AgentQueueState={schemaVersion:1,conversationId,revision:7,paused:false,preparingInputId:null,
  inputs:[{inputId:queueInputId,text:"original instruction"}]};
function proof(intent:AgentSteeringHandoffIntent):AgentSteeringHandoffProof{
  return {schemaVersion:1,operationId:intent.operationId,conversationId:intent.conversationId,
    family:"agent.steering.handoff.prepare",epoch,sqlFence:"12",replayed:false,result:null};
}
function rolledBack(intent:AgentSteeringHandoffIntent){
  return {code:"DATA_SQL_OPERATION_CONFLICT",reason:{operationId:intent.operationId,epoch,sqlFence:"12",
    phase:"steering-handoff-prepare",sqliteCode:null,sqliteExtendedCode:null,safeCause:"handoff_queue_changed"}};
}
function fixture(){
  let saved:AgentSteeringHandoffIntent|null=null,disabled=false;
  const prepare=vi.fn(async(intent:AgentSteeringHandoffIntent)=>{saved=structuredClone(intent);return proof(intent);});
  const invoke=vi.fn(async(command:string,args:Record<string,unknown>):Promise<unknown>=>{
    if(command==="agent_read_steering_handoffs")return {schemaVersion:1,conversationId,epoch,
      items:saved?[{intent:saved,proof:proof(saved),history:"unconfirmed"}]:[]};
    if(command==="agent_prepare_steering_handoff")return prepare(decodeAgentSteeringHandoffIntent(args.request));
    if(command==="agent_release_steering_handoff"&&saved){
      const released=saved;saved=null;
      return {...proof(released),family:"agent.steering.handoff.release",
        operationId:await agentSteeringHandoffResolvedId("agent.steering.handoff.release",released.operationId)};
    }
    throw Error(`unexpected ${command}`);
  });
  const steerInvoke=vi.fn(async(_command:string,_args:Record<string,unknown>):Promise<unknown>=>({schemaVersion:1,conversationId,turnId,inputId:steeringInputId}));
  const writing=createAgentSteeringGateway(steerInvoke);
  const send=vi.fn((request:Omit<AgentWritingSteerRequest,"manuscriptId">)=>writing.steerWriting({...request,manuscriptId:scope.manuscriptId}));
  const ids=[operationId,steeringInputId];
  const owner=new AgentSteeringHandoffController(conversationId,createAgentSteeringHandoffGateway(invoke),send,()=>ids.shift()!,value=>value.kind==="manuscript");
  return {owner,prepare,invoke,steerInvoke,send,isDisabled:()=>disabled,disable:()=>{disabled=true;},enable:()=>{disabled=false;}};
}

it("requires fresh admission after an operation-bound Native rollback while keeping the original identity",async()=>{
  const f=fixture();await f.owner.refresh(()=>false);
  f.prepare.mockImplementationOnce(async intent=>{throw rolledBack(intent);});
  expect(await f.owner.submit(queue,turnId,queueInputId,scope,f.isDisabled)).toBe(false);
  const original=f.owner.getSnapshot().intent;f.disable();
  expect(await f.owner.retry()).toBe(false);expect(f.prepare).toHaveBeenCalledOnce();expect(f.send).not.toHaveBeenCalled();
  expect(f.owner.getSnapshot().intent).toEqual(original);expect(f.owner.getSnapshot().message).toMatch(/^WRITING_RUNTIME_UNAVAILABLE：/u);
  f.enable();expect(await f.owner.retry()).toBe(true);expect(f.prepare.mock.calls[1]).toEqual(f.prepare.mock.calls[0]);
  expect(f.steerInvoke).toHaveBeenCalledOnce();expect(f.owner.getSnapshot().acceptedOperationIds).toEqual([operationId]);f.owner.dispose();
});

it.each(["operation","phase","epoch","missingEpoch","missingFence","missingSQLite","cause","unknownCode","bareCode"] as const)(
  "does not manufacture rejection evidence from a foreign or incomplete %s diagnostic",async field=>{
    const f=fixture();await f.owner.refresh(()=>false);
    f.prepare.mockImplementationOnce(async intent=>{
      const failure=rolledBack(intent);
      if(field==="operation")throw {...failure,reason:{...failure.reason,operationId:foreign}};
      if(field==="phase")throw {...failure,reason:{...failure.reason,phase:"steering-handoff-status"}};
      if(field==="epoch")throw {...failure,reason:{...failure.reason,epoch:foreign}};
      if(field==="missingEpoch"){const {epoch:_epoch,...reason}=failure.reason;throw {...failure,reason};}
      if(field==="missingFence"){const {sqlFence:_fence,...reason}=failure.reason;throw {...failure,reason};}
      if(field==="missingSQLite"){const {sqliteCode:_sqlite,...reason}=failure.reason;throw {...failure,reason};}
      if(field==="cause")throw {...failure,reason:{...failure.reason,safeCause:"sql_rollback_failed"}};
      if(field==="bareCode")throw {code:failure.code};
      throw {...failure,code:"DATA_SQL_COMMIT_UNKNOWN"};
    });
    expect(await f.owner.submit(queue,turnId,queueInputId,scope,f.isDisabled)).toBe(false);f.disable();
    expect(await f.owner.retry()).toBe(false);expect(f.prepare).toHaveBeenCalledTimes(2);
    expect(f.prepare.mock.calls[1]).toEqual(f.prepare.mock.calls[0]);expect(f.send).not.toHaveBeenCalled();
    expect(f.owner.getSnapshot().intent).toMatchObject({operationId,steeringInputId});f.owner.dispose();
  },
);

it("recognizes the original data-epoch-changed rejection with the actual differing owner epoch",async()=>{
  const f=fixture();await f.owner.refresh(()=>false);
  f.prepare.mockImplementationOnce(async intent=>{const failure=rolledBack(intent);
    throw {...failure,reason:{...failure.reason,epoch:foreign,safeCause:"data_epoch_changed"}};
  });
  await f.owner.submit(queue,turnId,queueInputId,scope,f.isDisabled);f.disable();
  expect(await f.owner.retry()).toBe(false);expect(f.prepare).toHaveBeenCalledOnce();expect(f.send).not.toHaveBeenCalled();
  expect(f.owner.getSnapshot().intent).toMatchObject({expectedEpoch:epoch,operationId});f.owner.dispose();
});

it("keeps a real Unknown prepare replayable when a later exact rollback cannot disprove its first commit",async()=>{
  const f=fixture();await f.owner.refresh(()=>false);
  f.prepare.mockRejectedValueOnce(Error("lost first receipt")).mockImplementationOnce(async intent=>{throw rolledBack(intent);});
  await f.owner.submit(queue,turnId,queueInputId,scope,f.isDisabled);f.disable();
  expect(await f.owner.retry()).toBe(false);expect(await f.owner.retry()).toBe(false);
  expect(f.prepare).toHaveBeenCalledTimes(3);
  expect(f.prepare.mock.calls[1]).toEqual(f.prepare.mock.calls[0]);expect(f.prepare.mock.calls[2]).toEqual(f.prepare.mock.calls[0]);
  expect(f.send).not.toHaveBeenCalled();expect(f.owner.getSnapshot().acceptedOperationIds).toEqual([]);f.owner.dispose();
});

it.each(["operationId","conversationId","epoch"] as const)("treats a mismatched actual-gateway %s proof as Unknown",async field=>{
  const f=fixture();await f.owner.refresh(()=>false);
  f.prepare.mockImplementationOnce(async intent=>({...proof(intent),[field]:foreign}));
  await f.owner.submit(queue,turnId,queueInputId,scope,f.isDisabled);
  expect(f.owner.getSnapshot().message).toContain("STEERING_HANDOFF_PROOF_MISMATCH");f.disable();
  expect(await f.owner.retry()).toBe(false);expect(f.prepare).toHaveBeenCalledTimes(2);
  expect(f.prepare.mock.calls[1]).toEqual(f.prepare.mock.calls[0]);expect(f.send).not.toHaveBeenCalled();f.owner.dispose();
});

it("keeps the registered claim when a first closed steer cannot be retried until admission returns",async()=>{
  const f=fixture();await f.owner.refresh(()=>false);f.steerInvoke.mockRejectedValueOnce({code:"closed"});
  expect(await f.owner.submit(queue,turnId,queueInputId,scope,f.isDisabled)).toBe(false);f.disable();
  const original=f.owner.getSnapshot().intent;
  expect(await f.owner.retry()).toBe(false);expect(f.prepare).toHaveBeenCalledOnce();expect(f.steerInvoke).toHaveBeenCalledOnce();
  expect(f.owner.getSnapshot().intent).toEqual(original);expect(f.owner.getSnapshot().acceptedOperationIds).toEqual([]);
  expect(await f.owner.refresh(id=>id===turnId)).toBe(true);
  expect(f.invoke.mock.calls.filter(([command])=>command==="agent_release_steering_handoff")).toHaveLength(1);
  expect(f.steerInvoke).toHaveBeenCalledOnce();expect(f.owner.getSnapshot().intent).toBeNull();f.owner.dispose();
});

it("retains exact steer Unknown replay after a later rejection while the instance is disabled",async()=>{
  const f=fixture();await f.owner.refresh(()=>false);
  f.steerInvoke.mockRejectedValueOnce(Error("lost steer receipt")).mockRejectedValueOnce({code:"closed"});
  expect(await f.owner.submit(queue,turnId,queueInputId,scope,f.isDisabled)).toBe(false);f.disable();
  expect(await f.owner.retry()).toBe(false);expect(await f.owner.retry()).toBe(true);
  expect(f.prepare).toHaveBeenCalledOnce();expect(f.steerInvoke).toHaveBeenCalledTimes(3);
  expect(f.steerInvoke.mock.calls[1]).toEqual(f.steerInvoke.mock.calls[0]);expect(f.steerInvoke.mock.calls[2]).toEqual(f.steerInvoke.mock.calls[0]);
  expect(f.owner.getSnapshot().acceptedOperationIds).toEqual([operationId]);f.owner.dispose();
});
