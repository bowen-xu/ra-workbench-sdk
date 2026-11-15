import { AgentCatalogDecodeError, decodeAgentForkRequest, decodeAgentForkResponse, type AgentForkRequest, type AgentForkResponse } from "@research-assistant/core/agent";
import type { AgentMetadataInvoke } from "./index";
import { decodeAgentForkStatus, decodeAgentForkWriteOptions, type AgentForkStatusResponse, type AgentForkWriteOptions } from "@research-assistant/core/agent";
import { decodeAgentForkOriginRequest, decodeAgentForkOriginResponse, type AgentForkOriginRequest, type AgentForkOriginResponse } from "@research-assistant/core/agent";

export interface AgentForkOriginGateway { read(request: AgentForkOriginRequest): Promise<AgentForkOriginResponse> }
export function createAgentForkOriginGateway(invoke: AgentMetadataInvoke): AgentForkOriginGateway {
  return { async read(input) {
    const request = decodeAgentForkOriginRequest(input);
    const result = decodeAgentForkOriginResponse(await invoke("agent_read_conversation_fork_origin", { request }));
    if (result.conversationId !== request.conversationId) throw new AgentCatalogDecodeError();
    return result;
  } };
}

export interface AgentForkGateway {
  fork(request: AgentForkRequest, options?: AgentForkWriteOptions): Promise<AgentForkResponse>;
  /** Original intent only; no history drain, metadata read or implicit retry. */
  status(request: AgentForkRequest): Promise<AgentForkStatusResponse>;
}
/** Explicit idempotency identity comes from the caller; never silently retry or start a turn. */
export function createAgentForkGateway(invoke: AgentMetadataInvoke): AgentForkGateway {
  return { async status(input) {
    const request = decodeAgentForkRequest(input);
    const result = decodeAgentForkStatus(await invoke("agent_read_conversation_fork_status", { request }));
    if (result.operationId !== request.childId) throw new AgentCatalogDecodeError();
    return result;
  }, async fork(input, options) {
    const request = decodeAgentForkRequest(input);
    const precondition = options === undefined ? {} : decodeAgentForkWriteOptions(options);
    const result = decodeAgentForkResponse(await invoke("agent_fork_conversation", { request: {...request, ...precondition} }));
    if (result.conversation.id !== request.childId || result.parentId !== request.parentId || result.throughTurnId !== request.throughTurnId) throw new AgentCatalogDecodeError();
    return result;
  } };
}
