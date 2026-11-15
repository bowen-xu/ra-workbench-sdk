import { decodeAgentContextConfigurationSeedIntent, decodeAgentContextConfigurationSeedProof, decodeAgentContextConfigurationSeedStatus,
  type AgentContextConfigurationSeedIntent, type AgentContextConfigurationSeedProof, type AgentContextConfigurationSeedStatus } from "@research-assistant/core/agent";
import type { AgentMetadataInvoke } from "./index";

export interface AgentContextConfigurationSeedGateway {
  seed(intent: AgentContextConfigurationSeedIntent): Promise<AgentContextConfigurationSeedProof>;
  status(intent: AgentContextConfigurationSeedIntent): Promise<AgentContextConfigurationSeedStatus>;
}
function check(proof: AgentContextConfigurationSeedProof, intent: AgentContextConfigurationSeedIntent): AgentContextConfigurationSeedProof {
  if (proof.operationId !== intent.operationId || proof.conversationId !== intent.conversationId || proof.epoch !== intent.expectedEpoch)
    throw new Error("CONTEXT_CONFIGURATION_SEED_PROOF_MISMATCH");
  return proof;
}
export function createAgentContextConfigurationSeedGateway(invoke: AgentMetadataInvoke): AgentContextConfigurationSeedGateway {
  return {
    async seed(input) {
      const intent = decodeAgentContextConfigurationSeedIntent(input);
      return check(decodeAgentContextConfigurationSeedProof(await invoke("agent_seed_context_configuration_proven", { request: structuredClone(intent) })), intent);
    },
    async status(input) {
      const intent = decodeAgentContextConfigurationSeedIntent(input);
      const status = decodeAgentContextConfigurationSeedStatus(await invoke("agent_read_context_configuration_seed_status", { request: structuredClone(intent) }));
      if (status.type === "committed") check(status.proof, intent);
      else if (status.epoch !== intent.expectedEpoch) throw new Error("CONTEXT_CONFIGURATION_SEED_EPOCH_MISMATCH");
      return status;
    },
  };
}
