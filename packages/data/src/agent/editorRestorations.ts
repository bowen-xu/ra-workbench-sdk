import { AgentWorkspaceDecodeError, decodeAgentEditorRestorationRequest, decodeAgentEditorRestorationResponse,
  type AgentEditorRestorationRequest, type AgentEditorRestorationResponse } from "@research-assistant/core/agent";
import type { AgentMetadataInvoke } from "./index";

/** Restore is distinct from apply; only a fresh prepare edit authorizes dispatch. */
export function createAgentEditorRestorationGateway(invoke: AgentMetadataInvoke) {
  return { async execute(value: AgentEditorRestorationRequest): Promise<AgentEditorRestorationResponse> {
    const request=decodeAgentEditorRestorationRequest(value);
    const result=decodeAgentEditorRestorationResponse(await invoke("agent_writing_editor_restoration",{request}));
    const scope=result.kind==="edit"?result.scope:result.application.scope;
    for(const key of ["conversationId","manuscriptId","proposalId","operationId"] as const) {
      if(scope[key]!==request.scope[key]) throw new AgentWorkspaceDecodeError();
    }
    if(result.kind==="edit") {
      if(request.action!=="prepare" || result.restoreId!==request.restoreId
        || JSON.stringify(result.expected)!==JSON.stringify(request.current)) throw new AgentWorkspaceDecodeError();
    } else {
      const path=request.action==="read"?request.path:request.action==="prepare"?request.current.path:request.actual.path;
      if(result.path!==path) throw new AgentWorkspaceDecodeError();
      if(request.action!=="read" && result.restoration?.id!==request.restoreId) throw new AgentWorkspaceDecodeError();
      if(request.action==="confirm" && (result.restoration?.resultRevision!==request.actual.revision
        || result.restoration?.sessionId!==request.actual.sessionId)) throw new AgentWorkspaceDecodeError();
    }
    return result;
  }};
}
