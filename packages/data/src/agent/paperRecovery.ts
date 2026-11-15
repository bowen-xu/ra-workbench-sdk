import { decodeAgentPaperRecoveryPage, decodeAgentPaperRecoveryRequest, type AgentPaperRecoveryPage, type AgentPaperRecoveryRequest } from "@research-assistant/core/agent";
import type { AgentMetadataInvoke } from "./index";
export interface AgentPaperRecoveryGateway { list(request: AgentPaperRecoveryRequest): Promise<AgentPaperRecoveryPage> }
export function createAgentPaperRecoveryGateway(invoke: AgentMetadataInvoke): AgentPaperRecoveryGateway {
  return { async list(input) { const request = decodeAgentPaperRecoveryRequest(input); return decodeAgentPaperRecoveryPage(await invoke("agent_list_unstarted_paper_submissions", { request }), request); } };
}
