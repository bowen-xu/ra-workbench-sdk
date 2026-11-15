import { AgentWorkspaceDecodeError, decodeAgentPendingWritingUndoPage, decodeAgentPendingWritingUndoRequest,
  type AgentPendingWritingUndoPage, type AgentPendingWritingUndoRequest } from "@research-assistant/core/agent";
import type { AgentMetadataInvoke } from "./index";

export interface AgentPendingWritingUndoGateway {
  list(request: AgentPendingWritingUndoRequest): Promise<AgentPendingWritingUndoPage>;
}
/** Lists existing native operations; it does not start, resume or acknowledge them. */
export function createAgentPendingWritingUndoGateway(invoke: AgentMetadataInvoke): AgentPendingWritingUndoGateway {
  return { async list(input) {
    const request = decodeAgentPendingWritingUndoRequest(input);
    const page = decodeAgentPendingWritingUndoPage(await invoke("agent_list_pending_writing_undos", { request }));
    if (page.manuscriptId !== request.manuscriptId || page.items.length > request.limit
      || (page.nextCursor !== null && page.items.length !== request.limit)
      || page.items.some(item => item.id <= (request.after ?? 0))) throw new AgentWorkspaceDecodeError();
    return page;
  } };
}
