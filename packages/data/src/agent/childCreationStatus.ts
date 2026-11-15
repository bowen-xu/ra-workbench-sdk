import { AgentCatalogDecodeError, decodeAgentChildCreationStatusRequest, decodeAgentChildCreationStatusResponse,
  type AgentChildCreationStatusRequest, type AgentChildCreationStatusResponse } from "@research-assistant/core/agent";
import type { AgentMetadataInvoke } from "./index";

export interface AgentChildCreationStatusGateway {
  /** Read original creation evidence only; this does not reconcile or restart a child. */
  read(request: AgentChildCreationStatusRequest): Promise<AgentChildCreationStatusResponse>;
}

export function createAgentChildCreationStatusGateway(invoke: AgentMetadataInvoke): AgentChildCreationStatusGateway {
  return {
    async read(request) {
      const frozen = decodeAgentChildCreationStatusRequest(request);
      const response = decodeAgentChildCreationStatusResponse(await invoke("agent_read_child_creation_status", { request: frozen }));
      if (response.conversationId !== frozen.conversationId || response.turnId !== frozen.turnId || response.callId !== frozen.callId)
        throw new AgentCatalogDecodeError();
      return response;
    },
  };
}
