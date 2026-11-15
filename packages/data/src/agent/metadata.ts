import { AgentCatalogDecodeError, decodeAgentRenameResponse, type AgentMetadataRequest, type AgentConversationSummary } from "@research-assistant/core/agent";
import type { AgentMetadataInvoke } from "./index";

export interface AgentMetadataGateway {
  read(request: AgentMetadataRequest): Promise<AgentConversationSummary>;
}

/** Exact metadata lookup, independent of list filters and without opening a runtime. */
export function createAgentMetadataGateway(invoke: AgentMetadataInvoke): AgentMetadataGateway {
  return {
    async read(request) {
      if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(request.id)
        || request.id === "00000000-0000-0000-0000-000000000000") throw new AgentCatalogDecodeError();
      const result = decodeAgentRenameResponse(await invoke("agent_read_conversation_metadata", { request })).conversation;
      if (result.id !== request.id.toLowerCase()) throw new AgentCatalogDecodeError();
      return result;
    },
  };
}
