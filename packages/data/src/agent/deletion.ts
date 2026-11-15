import { AgentCatalogDecodeError, decodeAgentDeletionRequest, decodeAgentDeletionResponse, type AgentDeletionRequest, type AgentDeletionResponse } from "@research-assistant/core/agent";
import type { AgentMetadataInvoke } from "./index";
import { decodeAgentDeletionStatus, decodeAgentDeletionWriteOptions, type AgentDeletionStatusResponse, type AgentDeletionWriteOptions } from "@research-assistant/core/agent";

export interface AgentDeletionGateway {
  delete(request: AgentDeletionRequest, options?: AgentDeletionWriteOptions): Promise<AgentDeletionResponse>;
  /** Exact original confirmation only. Never drains history or retries deletion. */
  status(request: AgentDeletionRequest): Promise<AgentDeletionStatusResponse>;
}
/** Only the exact durable receipt confirms deletion. A lost response requires explicit same-ID retry. */
export function createAgentDeletionGateway(invoke: AgentMetadataInvoke): AgentDeletionGateway {
  return { async status(input) {
    const request = decodeAgentDeletionRequest(input);
    const result = decodeAgentDeletionStatus(await invoke("agent_read_conversation_deletion_status", { request }));
    if (result.operationId !== request.requestId || result.conversationId !== request.conversationId) throw new AgentCatalogDecodeError();
    return result;
  }, async delete(input, options) {
    const request = decodeAgentDeletionRequest(input);
    const precondition = options === undefined ? {} : decodeAgentDeletionWriteOptions(options);
    const result = decodeAgentDeletionResponse(await invoke("agent_delete_conversation", { request: {...request, ...precondition} }));
    if (result.requestId !== request.requestId || result.conversationId !== request.conversationId) throw new AgentCatalogDecodeError();
    return result;
  } };
}
