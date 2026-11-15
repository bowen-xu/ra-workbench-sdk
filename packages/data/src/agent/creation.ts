import { AgentCatalogDecodeError, decodeAgentCreateBoundRequest, decodeAgentCreateBoundProof, decodeAgentCreateBoundStatus,
  type AgentCreateBoundRequest, type AgentCreateBoundProof, type AgentCreateBoundStatusResponse } from "@research-assistant/core/agent";
import type { AgentMetadataInvoke } from "./index";

export interface AgentCreationGateway {
  createBound(request: AgentCreateBoundRequest): Promise<AgentCreateBoundProof>;
  /** Read-only receipt inspection; never drains, reads current metadata or retries. */
  createBoundStatus(request: AgentCreateBoundRequest): Promise<AgentCreateBoundStatusResponse>;
}
/** One atomic metadata command. Opening the runtime is a separate explicit action. */
export function createAgentCreationGateway(invoke: AgentMetadataInvoke): AgentCreationGateway {
  return {
    async createBound(request) {
      const frozen = decodeAgentCreateBoundRequest(request);
      const result = decodeAgentCreateBoundProof(await invoke("agent_create_bound_conversation", { request: frozen }));
      if (result.conversationId !== frozen.id || result.operationId !== frozen.operationId) throw new AgentCatalogDecodeError();
      return result;
    },
    async createBoundStatus(request) {
      const frozen = decodeAgentCreateBoundRequest(request);
      const result = decodeAgentCreateBoundStatus(await invoke("agent_read_bound_conversation_creation_status", { request: frozen }));
      if (result.conversationId !== frozen.id || result.operationId !== frozen.operationId) throw new AgentCatalogDecodeError();
      return result;
    },
  };
}
