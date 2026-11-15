import { AgentSubmissionDecodeError, decodeAgentQueueAdmissionsRequest, decodeAgentQueueAdmissionsPage,
  type AgentQueueAdmissionsRequest, type AgentQueueAdmissionsPage } from "@research-assistant/core/agent";
import type { AgentMetadataInvoke } from "./index";
export interface AgentQueueAdmissionsGateway {
  list(request: AgentQueueAdmissionsRequest): Promise<AgentQueueAdmissionsPage>;
}
export function createAgentQueueAdmissionsGateway(invoke: AgentMetadataInvoke): AgentQueueAdmissionsGateway {
  return { async list(input) {
    const request = decodeAgentQueueAdmissionsRequest(input);
    const page = decodeAgentQueueAdmissionsPage(await invoke("agent_list_unstarted_writing_queue_admissions", { request }));
    if (page.conversationId !== request.conversationId || page.manuscriptId !== request.manuscriptId
      || page.items.length > request.limit || (page.nextCursor !== null && page.items.length !== request.limit)
      || page.items.some((item) => request.after !== null && item.inputId <= request.after)) throw new AgentSubmissionDecodeError();
    return page;
  } };
}
