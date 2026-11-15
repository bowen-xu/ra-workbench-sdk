import { decodeAgentInterruptResponse, AgentSessionDecodeError, type AgentInterruptRequest, type AgentInterruptResponse } from "@research-assistant/core/agent";
import type { AgentMetadataInvoke } from "./index";

export interface AgentTurnGateway {
  interrupt(request: AgentInterruptRequest): Promise<AgentInterruptResponse>;
}
export function createAgentTurnGateway(invoke: AgentMetadataInvoke): AgentTurnGateway {
  return {
    async interrupt(request) {
      const response = decodeAgentInterruptResponse(await invoke("agent_interrupt_turn", { request }));
      if (response.conversationId !== request.conversationId.toLowerCase() || response.turnId !== request.turnId.toLowerCase()) throw new AgentSessionDecodeError();
      return response;
    },
  };
}
