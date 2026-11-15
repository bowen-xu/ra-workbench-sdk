import { decodeAgentContextConfigurationEnvironment, decodeAgentContextConfigurationEnvironmentRequest, decodeAgentContextConfigurationSaveIntent, decodeAgentContextConfigurationSaveProof, decodeAgentContextConfigurationSaveStatus,
  type AgentContextConfigurationEnvironment, type AgentContextConfigurationEnvironmentRequest, type AgentContextConfigurationSaveIntent, type AgentContextConfigurationSaveProof, type AgentContextConfigurationSaveStatus } from "@research-assistant/core/agent";
import type { AgentMetadataInvoke } from "./index";

export interface AgentContextConfigurationSaveGateway {
  environment(request:AgentContextConfigurationEnvironmentRequest):Promise<AgentContextConfigurationEnvironment>;
  save(intent: AgentContextConfigurationSaveIntent): Promise<AgentContextConfigurationSaveProof>;
  status(intent: AgentContextConfigurationSaveIntent): Promise<AgentContextConfigurationSaveStatus>;
}
function checkedProof(proof:AgentContextConfigurationSaveProof,intent:AgentContextConfigurationSaveIntent):AgentContextConfigurationSaveProof {
  if(proof.operationId!==intent.operationId || proof.conversationId!==intent.conversationId || proof.epoch!==intent.expectedEpoch)throw new Error("CONTEXT_CONFIGURATION_PROOF_MISMATCH");
  return proof;
}
export function createAgentContextConfigurationSaveGateway(invoke:AgentMetadataInvoke):AgentContextConfigurationSaveGateway {
  return {
    async environment(input) {
      const request=decodeAgentContextConfigurationEnvironmentRequest(input);
      const environment=decodeAgentContextConfigurationEnvironment(await invoke("agent_read_context_configuration_environment",{request}));
      if(environment.operationId!==request.operationId || environment.conversationId!==request.conversationId)throw new Error("CONTEXT_CONFIGURATION_ENVIRONMENT_MISMATCH");
      return environment;
    },
    async save(input) {
      const intent=decodeAgentContextConfigurationSaveIntent(input);
      return checkedProof(decodeAgentContextConfigurationSaveProof(await invoke("agent_save_context_configuration_proven",{request:structuredClone(intent)})),intent);
    },
    async status(input) {
      const intent=decodeAgentContextConfigurationSaveIntent(input);
      const status=decodeAgentContextConfigurationSaveStatus(await invoke("agent_read_context_configuration_save_status",{request:structuredClone(intent)}));
      if(status.type==="committed")checkedProof(status.proof,intent);
      else if(status.epoch!==intent.expectedEpoch)throw new Error("CONTEXT_CONFIGURATION_EPOCH_MISMATCH");
      return status;
    },
  };
}
