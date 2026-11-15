import { AgentWorkspaceDecodeError, decodeAgentApplicationRequest, decodeAgentApplicationResponse,
  type AgentApplicationRequest, type AgentApplicationResponse, type AgentApplicationState, type AgentProposalRequest } from "@research-assistant/core/agent";
import type { AgentMetadataInvoke } from "./index";

/** Only the writing host invokes this boundary after explicit acceptance.
 * Responses may be historical; only `edit` authorizes one live-port dispatch.
 */
export function createAgentApplicationGateway(invoke: AgentMetadataInvoke): {
  find(request: AgentProposalRequest): Promise<AgentApplicationState | null>;
  execute(request: AgentApplicationRequest): Promise<AgentApplicationResponse>;
} {
  return {async find(value) {
    const request={...value};
    const raw=await invoke("agent_find_writing_proposal_application",{request});
    if(raw===null)return null;
    const result=decodeAgentApplicationResponse(raw);
    if(result.kind!=="state")throw new AgentWorkspaceDecodeError();
    for(const key of ["conversationId","manuscriptId","proposalId"] as const) {
      if(result.scope[key]!==request[key].toLowerCase())throw new AgentWorkspaceDecodeError();
    }
    return result;
  }, async execute(value) {
    const request=decodeAgentApplicationRequest(value), scope=request.scope;
    const result=decodeAgentApplicationResponse(await invoke("agent_writing_proposal_application",{request}));
    for(const key of ["conversationId","manuscriptId","proposalId","operationId"] as const) {
      if(result.scope[key]!==scope[key]) throw new AgentWorkspaceDecodeError();
    }
    if(request.action==="resume" && (result.kind!=="state" || result.status!=="applying")) {
      throw new AgentWorkspaceDecodeError();
    }
    if(request.action==="prepareRollback" && (result.kind!=="state" || !["recoveryRequired", "rolledBack"].includes(result.status))) {
      throw new AgentWorkspaceDecodeError();
    }
    if(result.kind==="edit") {
      if(request.action!=="prepareEditor" || JSON.stringify(result.expected)!==JSON.stringify(request.current)) throw new AgentWorkspaceDecodeError();
    } else if(request.action==="rollbackRemainder") {
      if(result.status!=="rolledBack" || result.files.some(file=>file.target.kind==="editor" && file.phase==="restored" && file.target.resultRevision===null)) throw new AgentWorkspaceDecodeError();
    } else if(request.action==="rollbackDisk") {
      if(result.status!=="rolledBack" || result.files.some(file=>file.target.kind!=="disk")) throw new AgentWorkspaceDecodeError();
    } else if(request.action==="applyDisk" || request.action==="reconcileDisk") {
      const file=result.files.find(f=>f.path===request.path);
      if(!file || file.target.kind!=="disk") throw new AgentWorkspaceDecodeError();
    } else if(request.action==="confirmEditor") {
      const file=result.files.find(f=>f.path===request.actual.path);
      if(!file || file.phase!=="acknowledged" || file.target.kind!=="editor"
        || file.target.sessionId!==request.actual.sessionId || file.target.resultRevision!==request.actual.revision) throw new AgentWorkspaceDecodeError();
    }
    return result;
  }};
}
