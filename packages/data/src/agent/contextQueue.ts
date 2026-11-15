import { AgentSubmissionDecodeError, decodeAgentContextQueueScope, decodeAgentContextQueueEditRequest,
  decodeAgentQueueState, type AgentContextQueueScope, type AgentContextQueueEditRequest,
  type AgentQueueState } from "@research-assistant/core/agent";
import type { AgentMetadataInvoke } from "./index";
import type { AgentQueueGateway } from "./inputQueueController";
import { freezeQueueEditRequest, inspectQueueEdit, type AgentQueueEditInspection } from "./queueEditInspection";

export type AgentContextQueueGateway = Omit<AgentQueueGateway<AgentContextQueueScope, AgentQueueState>, "edit"> & {
  edit(request: AgentContextQueueEditRequest): Promise<AgentQueueState>;
};
function checked(value: unknown, scope: AgentContextQueueScope): AgentQueueState {
  const queue = decodeAgentQueueState(value);
  if (queue.conversationId !== scope.conversationId) throw new AgentSubmissionDecodeError();
  return queue;
}
export function createAgentContextQueueGateway(invoke: AgentMetadataInvoke): AgentContextQueueGateway & AgentQueueEditInspection<AgentContextQueueEditRequest> {
  return {
    async read(input) {
      const scope = decodeAgentContextQueueScope(input);
      return checked(await invoke("agent_read_context_input_queue", {request: scope}), scope);
    },
    async edit(input) {
      const request = freezeQueueEditRequest(input, decodeAgentContextQueueEditRequest);
      const queue = checked(await invoke("agent_edit_context_input_queue", {request: structuredClone(request)}), request);
      if (queue.revision !== request.expectedRevision + 1) throw new AgentSubmissionDecodeError();
      return queue;
    },
    inspectEdit: input => inspectQueueEdit(invoke, "agent_read_context_input_queue_edit_status", input, decodeAgentContextQueueEditRequest),
  };
}
