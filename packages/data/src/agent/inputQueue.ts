import { AgentSubmissionDecodeError, decodeAgentWritingQueueScope, decodeAgentWritingQueueEditRequest,
  decodeAgentWritingQueueResponse, type AgentWritingQueueScope, type AgentWritingQueueEditRequest,
  type AgentWritingQueueResponse } from "@research-assistant/core/agent";
import type { AgentMetadataInvoke } from "./index";
import { freezeQueueEditRequest, inspectQueueEdit, type AgentQueueEditInspection } from "./queueEditInspection";

export interface AgentInputQueueGateway {
  read(request: AgentWritingQueueScope): Promise<AgentWritingQueueResponse>;
  edit(request: AgentWritingQueueEditRequest): Promise<AgentWritingQueueResponse>;
}
function scoped(value: unknown, request: AgentWritingQueueScope): AgentWritingQueueResponse {
  const response = decodeAgentWritingQueueResponse(value);
  if (response.conversationId !== request.conversationId || response.manuscriptId !== request.manuscriptId) {
    throw new AgentSubmissionDecodeError();
  }
  return response;
}
/** No automatic retries: callers retain request IDs and reconcile revision changes. */
export function createAgentInputQueueGateway(invoke: AgentMetadataInvoke): AgentInputQueueGateway & AgentQueueEditInspection<AgentWritingQueueEditRequest> {
  return {
    async read(input) {
      const request = decodeAgentWritingQueueScope(input);
      return scoped(await invoke("agent_read_writing_input_queue", { request }), request);
    },
    async edit(input) {
      const request = freezeQueueEditRequest(input, decodeAgentWritingQueueEditRequest);
      const response = scoped(await invoke("agent_edit_writing_input_queue", { request }), request);
      if (response.revision !== request.expectedRevision + 1) throw new AgentSubmissionDecodeError();
      return response;
    },
    inspectEdit: input => inspectQueueEdit(invoke, "agent_read_writing_input_queue_edit_status", input, decodeAgentWritingQueueEditRequest),
  };
}
