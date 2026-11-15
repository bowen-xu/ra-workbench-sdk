import { AgentCatalogDecodeError, decodeAgentSearchPage, type AgentSearchRequest, type AgentSearchPage } from "@research-assistant/core/agent";
import type { AgentMetadataInvoke } from "./index";

export interface AgentSearchGateway { search(request: AgentSearchRequest): Promise<AgentSearchPage> }
export function createAgentSearchGateway(invoke: AgentMetadataInvoke): AgentSearchGateway {
  return { async search(request) {
    const term = request.term.trim();
    if (!term || [...term].length > 200 || term.includes("\0") || !Number.isInteger(request.scope.limit)
      || request.scope.limit < 1 || request.scope.limit > 100) throw new AgentCatalogDecodeError();
    const page = decodeAgentSearchPage(await invoke("agent_search_conversations", { request: { ...request, term } }));
    if (page.hits.length > request.scope.limit || page.hits.some((hit) => hit.conversation.archived !== request.scope.archived
      || Boolean(hit.conversation.internal) !== Boolean(request.scope.internal))) throw new AgentCatalogDecodeError();
    return page;
  } };
}
