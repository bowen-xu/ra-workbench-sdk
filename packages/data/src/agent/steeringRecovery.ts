import { decodeAgentWritingRecoveryResponse, AgentSubmissionDecodeError,
  type AgentWritingRecoveryRequest, type AgentWritingRecoveryResponse } from "@research-assistant/core/agent";
import type { AgentMetadataInvoke } from "./index";

export interface AgentSteeringRecoveryGateway {
  readWritingRecovery(request: AgentWritingRecoveryRequest): Promise<AgentWritingRecoveryResponse>;
}
export function createAgentSteeringRecoveryGateway(invoke: AgentMetadataInvoke): AgentSteeringRecoveryGateway {
  return {
    async readWritingRecovery(request) {
      const response = decodeAgentWritingRecoveryResponse(await invoke("agent_read_writing_steering_recovery", { request }));
      if (response.conversationId !== request.conversationId.toLowerCase()
        || response.manuscriptId !== request.manuscriptId.toLowerCase()
        || response.turnId !== request.turnId.toLowerCase()) throw new AgentSubmissionDecodeError();
      return response;
    },
  };
}
