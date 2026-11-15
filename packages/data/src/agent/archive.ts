import { AgentCatalogDecodeError, decodeAgentArchiveRequest, decodeAgentArchiveProof, decodeAgentArchiveStatus,
  type AgentArchiveRequest, type AgentArchiveProof, type AgentArchiveStatusResponse } from "@research-assistant/core/agent";
import type { AgentMetadataInvoke } from "./index";

export interface AgentArchiveGateway {
  setArchived(request: AgentArchiveRequest): Promise<AgentArchiveProof>;
  /** Inspect the exact original operation without reading current metadata. */
  archiveStatus(request: AgentArchiveRequest): Promise<AgentArchiveStatusResponse>;
}
/** Explicit reversible metadata mutation; no automatic retries or task execution. */
export function createAgentArchiveGateway(invoke: AgentMetadataInvoke): AgentArchiveGateway {
  return {
    async setArchived(request) {
      const frozen = decodeAgentArchiveRequest(request);
      const result = decodeAgentArchiveProof(await invoke("agent_set_conversation_archived", { request: frozen }));
      if (result.operationId !== frozen.operationId || result.conversationId !== frozen.id) throw new AgentCatalogDecodeError();
      return result;
    },
    async archiveStatus(request) {
      const frozen = decodeAgentArchiveRequest(request);
      const result = decodeAgentArchiveStatus(await invoke("agent_read_conversation_archive_status", { request: frozen }));
      if (result.operationId !== frozen.operationId || result.conversationId !== frozen.id) throw new AgentCatalogDecodeError();
      return result;
    },
  };
}
