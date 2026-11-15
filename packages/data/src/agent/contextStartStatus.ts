import {decodeAgentContextStartRequest, decodeAgentContextStartStatusResponse, decodeAgentDeletionWriteOptions, decodeAgentStartResponse,
  sameAgentContextStartRequest, type AgentContextStartRequest, type AgentContextStartStatusResponse, type AgentStartResponse} from "@research-assistant/core/agent";
import type {AgentMetadataInvoke} from "./index";

export interface AgentContextStartGateway {
  start(request: AgentContextStartRequest, expectedEpoch: string): Promise<AgentStartResponse>;
  read(request: AgentContextStartRequest, expectedEpoch: string): Promise<AgentContextStartStatusResponse>;
}
export function createAgentContextStartGateway(invoke: AgentMetadataInvoke): AgentContextStartGateway {
  return {
    async start(request, epoch) {
      const intent = decodeAgentContextStartRequest(request), {expectedEpoch} = decodeAgentDeletionWriteOptions({expectedEpoch: epoch});
      const result = decodeAgentStartResponse(await invoke("agent_start_context_submission_guarded", {request: intent, expectedEpoch}));
      if (result.conversationId !== intent.conversationId || result.requestId !== intent.requestId) throw new Error("Mismatched context start result");
      return result;
    },
    async read(request, epoch) {
      const intent = decodeAgentContextStartRequest(request), {expectedEpoch} = decodeAgentDeletionWriteOptions({expectedEpoch: epoch});
      const response = decodeAgentContextStartStatusResponse(await invoke("agent_read_context_start_status", {request: intent, expectedEpoch}));
      if (!sameAgentContextStartRequest(intent, response.intent) || response.expectedEpoch !== expectedEpoch) throw new Error("Mismatched context start intent");
      return response;
    },
  };
}
