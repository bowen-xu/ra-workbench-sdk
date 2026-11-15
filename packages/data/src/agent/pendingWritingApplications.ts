import { AgentWorkspaceDecodeError, decodeAgentPendingWritingApplicationPage, decodeAgentPendingWritingApplicationRequest,
  type AgentPendingWritingApplicationPage, type AgentPendingWritingApplicationRequest } from "@research-assistant/core/agent";
import type { AgentMetadataInvoke } from "./index";

export interface AgentPendingWritingApplicationGateway {
  list(request: AgentPendingWritingApplicationRequest): Promise<AgentPendingWritingApplicationPage>;
}
/** Reads admitted operations even when their originating chat no longer exists. */
export function createAgentPendingWritingApplicationGateway(invoke: AgentMetadataInvoke): AgentPendingWritingApplicationGateway {
  return { async list(input) {
    const request = decodeAgentPendingWritingApplicationRequest(input);
    const page = decodeAgentPendingWritingApplicationPage(await invoke("agent_list_pending_writing_applications", { request }));
    if (page.manuscriptId !== request.manuscriptId || page.items.length > request.limit
      || (page.nextCursor !== null && page.items.length !== request.limit)
      || page.items.some(item => item.id <= (request.after ?? 0))) throw new AgentWorkspaceDecodeError();
    return page;
  } };
}
