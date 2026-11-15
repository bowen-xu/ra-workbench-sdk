import {expect, it, vi} from "vitest";
import {createAgentSteeringHandoffGateway} from "./steeringHandoff";
import type {AgentSteeringHandoffIntent} from "@research-assistant/core/agent";

const operationId="11111111-1111-4111-8111-111111111111";
const conversationId="22222222-2222-4222-8222-222222222222";
const epoch="33333333-3333-4333-8333-333333333333";
const intent:AgentSteeringHandoffIntent={operationId,conversationId,turnId:"44444444-4444-4444-8444-444444444444",
  steeringInputId:"55555555-5555-4555-8555-555555555555",queueInputId:"66666666-6666-4666-8666-666666666666",
  expectedRevision:2,expectedEpoch:epoch,scope:{kind:"context"},queueIndex:0,queuePaused:false,inputPaused:false,
  origin:null,text:"queued input",userInput:[]};
const proof=(family:string,id=operationId)=>({schemaVersion:1,operationId:id,conversationId,family,epoch,sqlFence:"0",replayed:false,result:null});

it("uses the same frozen intent and verifies all three native receipts",async()=>{
  const invoke=vi.fn(async(command:string)=>command==="agent_prepare_steering_handoff" ? proof("agent.steering.handoff.prepare")
    : command==="agent_finish_steering_handoff" ? proof("agent.steering.handoff.finish","80bc4aec-5641-8d96-b55b-b7c069dd19b7")
    : command==="agent_release_steering_handoff" ? proof("agent.steering.handoff.release","1ed3e13b-338b-810e-8595-025ab9430629")
    : proof("agent.steering.handoff.cancel","bebf18c6-6c16-87a8-a739-e303455bbad4"));
  const gateway=createAgentSteeringHandoffGateway(invoke);
  await gateway.prepare(intent); await gateway.finish(intent,epoch); await gateway.release(intent,epoch); await gateway.cancelUnregistered(intent,epoch);
  expect(invoke.mock.calls[0]).toEqual(["agent_prepare_steering_handoff",{request:intent}]);
  expect(invoke.mock.calls[1]).toEqual(["agent_finish_steering_handoff",{request:{intent,expectedEpoch:epoch}}]);
  expect(invoke.mock.calls[2]).toEqual(["agent_release_steering_handoff",{request:{intent,expectedEpoch:epoch}}]);
  expect(invoke.mock.calls[3]).toEqual(["agent_cancel_unregistered_steering_handoff",{request:{intent,expectedEpoch:epoch}}]);
});

it("requires a matching immutable proof to recognize another window's resolution",async()=>{
  const invoke=vi.fn(async()=>({status:"finished",proof:proof("agent.steering.handoff.finish","80bc4aec-5641-8d96-b55b-b7c069dd19b7")}));
  const gateway=createAgentSteeringHandoffGateway(invoke);
  expect(await gateway.resolution(intent,epoch)).toBe("finished");
  expect(invoke).toHaveBeenCalledWith("agent_read_steering_handoff_resolution",{request:{intent,expectedEpoch:epoch}});
  invoke.mockResolvedValueOnce({status:"released",proof:proof("agent.steering.handoff.finish","80bc4aec-5641-8d96-b55b-b7c069dd19b7")});
  await expect(gateway.resolution(intent,epoch)).rejects.toThrow();
  invoke.mockResolvedValueOnce({status:"finished",proof:proof("agent.steering.handoff.finish",operationId)});
  await expect(gateway.resolution(intent,epoch)).rejects.toThrow("STEERING_HANDOFF_PROOF_MISMATCH");
});

it("refuses an incorrect receipt or epoch without treating it as completion",async()=>{
  const invoke=vi.fn(async()=>proof("agent.steering.handoff.finish"));
  const gateway=createAgentSteeringHandoffGateway(invoke);
  await expect(gateway.finish(intent,epoch)).rejects.toThrow("STEERING_HANDOFF_PROOF_MISMATCH");
  await expect(gateway.finish(intent,"77777777-7777-4777-8777-777777777777")).rejects.toThrow("STEERING_HANDOFF_EPOCH_MISMATCH");
  expect(invoke).toHaveBeenCalledTimes(1);
});

it("validates discovery identities, proof and history as one page",async()=>{
  const item={intent,proof:proof("agent.steering.handoff.prepare"),history:"unconfirmed"};
  const page={schemaVersion:1,conversationId,epoch,items:[item]};
  const invoke=vi.fn(async()=>page);
  const gateway=createAgentSteeringHandoffGateway(invoke);
  expect(await gateway.read(conversationId,epoch)).toEqual(page);
  invoke.mockResolvedValueOnce({...page,items:[item,item]});
  await expect(gateway.read(conversationId,epoch)).rejects.toThrow();
  invoke.mockResolvedValueOnce({...page,items:[{...item,proof:{...item.proof,operationId:epoch}}]});
  await expect(gateway.read(conversationId,epoch)).rejects.toThrow();
  invoke.mockResolvedValueOnce({...page,items:[{...item,history:"missing"}]});
  await expect(gateway.read(conversationId,epoch)).rejects.toThrow();
});
