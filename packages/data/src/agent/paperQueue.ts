import { AgentSubmissionDecodeError, decodeAgentPaperQueueEditRequest, decodeAgentPaperQueueResponse,
  decodeAgentPaperQueueScope, type AgentPaperQueueResponse,
  type AgentPaperQueueScope, type AgentPaperQueueEditRequest } from "@research-assistant/core/agent";
import type { AgentMetadataInvoke } from "./index";
import type { AgentQueueGateway } from "./inputQueueController";
import { freezeQueueEditRequest, inspectQueueEdit, type AgentQueueEditInspection } from "./queueEditInspection";

export type AgentPaperQueueGateway = Omit<AgentQueueGateway<AgentPaperQueueScope, AgentPaperQueueResponse>, "edit"> & {
  edit(request: AgentPaperQueueEditRequest): Promise<AgentPaperQueueResponse>;
};
function fail(): never { throw new AgentSubmissionDecodeError(); }
function match(actual: AgentPaperQueueResponse, expected: AgentPaperQueueScope): void {
  if (actual.conversationId !== expected.conversationId || actual.paperId !== expected.paperId) fail();
}
export function createAgentPaperQueueGateway(invoke: AgentMetadataInvoke): AgentPaperQueueGateway & AgentQueueEditInspection<AgentPaperQueueEditRequest> {
  return {
    async read(input) {
      const request = decodeAgentPaperQueueScope(input);
      const result = decodeAgentPaperQueueResponse(await invoke("agent_read_paper_input_queue", { request: structuredClone(request) }));
      match(result, request); return result;
    },
    async edit(input) {
      const request = freezeQueueEditRequest(input, decodeAgentPaperQueueEditRequest);
      const result = decodeAgentPaperQueueResponse(await invoke("agent_edit_paper_input_queue", { request: structuredClone(request) }));
      match(result, request);
      if (result.revision !== request.expectedRevision + 1) fail();
      return result;
    },
    inspectEdit: input => inspectQueueEdit(invoke, "agent_read_paper_input_queue_edit_status", input, decodeAgentPaperQueueEditRequest),
  };
}
