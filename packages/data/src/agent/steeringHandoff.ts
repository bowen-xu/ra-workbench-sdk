import { decodeAgentContextQueueScope, decodeAgentSteeringHandoffIntent, decodeAgentSteeringHandoffPage, decodeAgentSteeringHandoffProof,
  type AgentSteeringHandoffFamily, type AgentSteeringHandoffIntent, type AgentSteeringHandoffPage,
  type AgentSteeringHandoffProof } from "@research-assistant/core/agent";
import type { AgentMetadataInvoke } from "./index";

export interface AgentSteeringHandoffGateway {
  read(conversationId: string, expectedEpoch?: string): Promise<AgentSteeringHandoffPage>;
  resolution(intent: AgentSteeringHandoffIntent, epoch: string): Promise<"unconfirmed" | "finished" | "released" | "canceled">;
  prepare(intent: AgentSteeringHandoffIntent): Promise<AgentSteeringHandoffProof>;
  finish(intent: AgentSteeringHandoffIntent, epoch: string): Promise<AgentSteeringHandoffProof>;
  release(intent: AgentSteeringHandoffIntent, epoch: string): Promise<AgentSteeringHandoffProof>;
  cancelUnregistered(intent: AgentSteeringHandoffIntent, epoch: string): Promise<AgentSteeringHandoffProof>;
}

/** Mirrors the native namespaced UUIDv8 derivation from the immutable prepare ID. */
export async function agentSteeringHandoffResolvedId(family: AgentSteeringHandoffFamily, operationId: string): Promise<string> {
  const raw = operationId.replaceAll("-", "");
  const uuidBytes = Uint8Array.from(raw.match(/../gu) ?? [], pair => Number.parseInt(pair,16));
  const name = new TextEncoder().encode(family);
  const bytes = new Uint8Array(name.length + uuidBytes.length);
  bytes.set(name); bytes.set(uuidBytes,name.length);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256",bytes));
  const id = digest.slice(0,16); id[6] = (id[6]! & 15) | 128; id[8] = (id[8]! & 63) | 128;
  const hex = [...id].map(value=>value.toString(16).padStart(2,"0")).join("");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
export function createAgentSteeringHandoffGateway(invoke: AgentMetadataInvoke): AgentSteeringHandoffGateway {
  async function resolve(action: "finish" | "release" | "cancel", input: AgentSteeringHandoffIntent, epoch: string): Promise<AgentSteeringHandoffProof> {
    const intent=decodeAgentSteeringHandoffIntent(input), family=`agent.steering.handoff.${action}` as const;
    const expectedEpoch=decodeAgentContextQueueScope({conversationId:epoch}).conversationId;
    if(intent.expectedEpoch!==null && intent.expectedEpoch!==expectedEpoch)throw new Error("STEERING_HANDOFF_EPOCH_MISMATCH");
    // Compute before IPC so failure to verify identity never starts a mutation.
    const operationId=await agentSteeringHandoffResolvedId(family,intent.operationId);
    const command=action==="cancel"?"agent_cancel_unregistered_steering_handoff":`agent_${action}_steering_handoff`;
    const proof=decodeAgentSteeringHandoffProof(await invoke(command,{request:{intent:structuredClone(intent),expectedEpoch}}),family);
    if(proof.operationId!==operationId || proof.conversationId!==intent.conversationId || proof.epoch!==expectedEpoch)throw new Error("STEERING_HANDOFF_PROOF_MISMATCH");
    return proof;
  }
  return {
    async read(conversationId,expectedEpoch) {
      const scope=decodeAgentContextQueueScope({conversationId});
      const epoch=expectedEpoch===undefined?undefined:decodeAgentContextQueueScope({conversationId:expectedEpoch}).conversationId;
      const result=await invoke("agent_read_steering_handoffs",{request:{conversationId:scope.conversationId,expectedEpoch:epoch??null}});
      return decodeAgentSteeringHandoffPage(result,scope.conversationId,epoch);
    },
    async prepare(input) {
      const intent=decodeAgentSteeringHandoffIntent(input);
      const proof=decodeAgentSteeringHandoffProof(await invoke("agent_prepare_steering_handoff",{request:structuredClone(intent)}),"agent.steering.handoff.prepare");
      if(proof.operationId!==intent.operationId || proof.conversationId!==intent.conversationId || intent.expectedEpoch!==null && proof.epoch!==intent.expectedEpoch)throw new Error("STEERING_HANDOFF_PROOF_MISMATCH");
      return proof;
    },
    async resolution(input,epoch) {
      const intent=decodeAgentSteeringHandoffIntent(input);
      const expectedEpoch=decodeAgentContextQueueScope({conversationId:epoch}).conversationId;
      if(intent.expectedEpoch!==null && intent.expectedEpoch!==expectedEpoch)throw new Error("STEERING_HANDOFF_EPOCH_MISMATCH");
      const value=await invoke("agent_read_steering_handoff_resolution",{request:{intent:structuredClone(intent),expectedEpoch}});
      if(!value || typeof value!=="object" || Array.isArray(value))throw new Error("STEERING_HANDOFF_RESOLUTION_INVALID");
      const row=value as Record<string,unknown>;
      if(Object.keys(row).some(key=>key!=="status" && key!=="proof") || !Object.hasOwn(row,"proof"))throw new Error("STEERING_HANDOFF_RESOLUTION_INVALID");
      if(row.status==="unconfirmed" && row.proof===null)return "unconfirmed";
      const action=row.status==="finished"?"finish":row.status==="released"?"release":row.status==="canceled"?"cancel":null;
      if(!action)throw new Error("STEERING_HANDOFF_RESOLUTION_INVALID");
      const family=`agent.steering.handoff.${action}` as const;
      const proof=decodeAgentSteeringHandoffProof(row.proof,family);
      if(proof.operationId!==await agentSteeringHandoffResolvedId(family,intent.operationId) || proof.conversationId!==intent.conversationId || proof.epoch!==expectedEpoch)throw new Error("STEERING_HANDOFF_PROOF_MISMATCH");
      return row.status as "finished" | "released" | "canceled";
    },
    finish:(intent,epoch)=>resolve("finish",intent,epoch),
    release:(intent,epoch)=>resolve("release",intent,epoch),
    cancelUnregistered:(intent,epoch)=>resolve("cancel",intent,epoch),
  };
}
