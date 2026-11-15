import { AgentCatalogDecodeError, decodeAgentDeletionBatchRequests, decodeAgentDeletionBatchResponse,
  type AgentDeletionBatchResponse, type AgentDeletionRequest } from "@research-assistant/core/agent";
import type { AgentMetadataInvoke } from "./index";

export interface AgentDeletionBatchGateway {
  deleteBatch(requests: readonly AgentDeletionRequest[]): Promise<AgentDeletionBatchResponse>;
}

/** One call submits the frozen set. A missing response does not trigger a replay. */
export function createAgentDeletionBatchGateway(invoke: AgentMetadataInvoke): AgentDeletionBatchGateway {
  return {async deleteBatch(input) {
    const requests = decodeAgentDeletionBatchRequests(input);
    const response = decodeAgentDeletionBatchResponse(await invoke("agent_delete_conversations_batch", {requests}));
    const identities = new Map(requests.map(request => [request.requestId, request.conversationId]));
    if (response.results.length !== requests.length || response.results.some(result => {
      if (identities.get(result.requestId) !== result.conversationId) return true;
      identities.delete(result.requestId); return false;
    }) || identities.size !== 0) throw new AgentCatalogDecodeError();
    return response;
  }};
}
