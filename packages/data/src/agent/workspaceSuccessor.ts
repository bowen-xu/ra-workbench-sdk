import { AgentWorkspaceDecodeError, decodeAgentWorkspaceConfirmation,
  type AgentWorkspaceBuffer, type AgentWorkspaceConfirmation, type AgentWorkspaceScope } from "@research-assistant/core/agent";
import type { AgentMetadataInvoke } from "./index";

/** Original operation identity, retained even if preparation's response is lost. */
export interface AgentWorkspaceSuccessorIdentity {
  readonly scope: AgentWorkspaceScope;
  readonly turnId: string;
  readonly generation: number;
  readonly predecessorDeliveryId: string;
  readonly leaseId: string;
}
export interface AgentWorkspaceSuccessorPrepare extends AgentWorkspaceSuccessorIdentity {
  readonly buffers: readonly AgentWorkspaceBuffer[];
}
export interface AgentWorkspaceSuccessorGateway {
  prepare(request: AgentWorkspaceSuccessorPrepare): Promise<AgentWorkspaceConfirmation>;
  recover(request: AgentWorkspaceSuccessorIdentity): Promise<AgentWorkspaceConfirmation>;
}

export function createAgentWorkspaceSuccessorGateway(invoke: AgentMetadataInvoke): AgentWorkspaceSuccessorGateway {
  async function receive(command: string, input: AgentWorkspaceSuccessorIdentity, buffers?: readonly AgentWorkspaceBuffer[]) {
    const original = structuredClone(input);
    if (!Number.isInteger(original.generation) || original.generation < 1 || original.generation > 2_147_483_647) throw new AgentWorkspaceDecodeError();
    const expected = decodeAgentWorkspaceConfirmation({ scope: original.scope, turnId: original.turnId, leaseId: original.leaseId, manifestHash: "0".repeat(64) });
    decodeAgentWorkspaceConfirmation({ scope: original.scope, turnId: original.turnId, leaseId: original.predecessorDeliveryId, manifestHash: "0".repeat(64) });
    const request = { scope: original.scope, generation: original.generation,
      predecessorDeliveryId: original.predecessorDeliveryId, leaseId: original.leaseId,
      ...(buffers ? { buffers: structuredClone(buffers) } : {}) };
    const result = decodeAgentWorkspaceConfirmation(await invoke(command, { request }));
    for (const key of ["conversationId", "requestId", "manuscriptId", "contextSnapshotId"] as const) {
      if (result.scope[key] !== expected.scope[key]) throw new AgentWorkspaceDecodeError();
    }
    if (result.turnId !== expected.turnId || result.leaseId !== expected.leaseId) throw new AgentWorkspaceDecodeError();
    return result;
  }
  return {
    prepare: request => receive("agent_prepare_next_writing_workspace", request, request.buffers),
    recover: request => receive("agent_recover_next_writing_workspace", request),
  };
}
