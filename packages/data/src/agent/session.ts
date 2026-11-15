import {
  decodeAgentHistoryResponse, decodeAgentSessionResponse, AgentSessionDecodeError,
  type AgentHistoryRequest, type AgentHistoryResponse, type AgentSessionResponse,
  decodeAgentHistoryWaitResponse, type AgentHistoryWaitRequest, type AgentHistoryWaitResponse,
} from "@research-assistant/core/agent";
import type { AgentMetadataInvoke } from "./index";

export interface AgentSessionGateway {
  create(conversationId: string): Promise<AgentSessionResponse>;
  open(conversationId: string): Promise<AgentSessionResponse>;
  readHistory(request: AgentHistoryRequest): Promise<AgentHistoryResponse>;
  waitForHistory(request: AgentHistoryWaitRequest, signal?: AbortSignal): Promise<AgentHistoryWaitResponse>;
}
export function createAgentSessionGateway(invoke: AgentMetadataInvoke): AgentSessionGateway {
  const session = async (command: string, conversationId: string): Promise<AgentSessionResponse> => {
    const response = decodeAgentSessionResponse(await invoke(command, { request: { conversationId } }));
    if (response.conversationId !== conversationId.toLowerCase()) throw new AgentSessionDecodeError();
    return response;
  };
  return {
    create: (conversationId) => session("agent_create_conversation", conversationId),
    open: (conversationId) => session("agent_open_conversation", conversationId),
    async waitForHistory(request, signal) {
      const response = decodeAgentHistoryWaitResponse(await invoke("agent_wait_for_history", { request }, signal ? { signal } : undefined));
      if (response.conversationId !== request.conversationId.toLowerCase() || response.afterSeq !== request.afterSeq) throw new AgentSessionDecodeError();
      return response;
    },
    async readHistory(request) {
      const response = decodeAgentHistoryResponse(await invoke("agent_read_history", { request }));
      if (response.conversationId !== request.conversationId.toLowerCase() || response.afterSeq !== request.afterSeq
        || response.events.length > request.limit
        || (request.snapshotId !== undefined && response.snapshotId !== request.snapshotId.toLowerCase())) throw new AgentSessionDecodeError();
      return response;
    },
  };
}
