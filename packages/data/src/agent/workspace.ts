import { AgentWorkspaceDecodeError, decodeAgentWorkspacePreview, type AgentWorkspaceScope, type AgentWorkspacePrepare, type AgentWorkspaceConfirmation, type AgentWorkspacePreview } from "@research-assistant/core/agent";
import type { AgentMetadataInvoke } from "./index";

export interface AgentWorkspaceGateway {
  prepare(request: AgentWorkspacePrepare): Promise<AgentWorkspacePreview>;
  restore(request: AgentWorkspaceScope): Promise<AgentWorkspacePreview>;
  approve(request: AgentWorkspaceConfirmation): Promise<AgentWorkspacePreview>;
  revoke(request: AgentWorkspaceConfirmation): Promise<void>;
}
/** Consent is a separate user action; preparing a copy never approves it. */
export function createAgentWorkspaceGateway(invoke: AgentMetadataInvoke): AgentWorkspaceGateway {
  async function receive(command: string, request: unknown, scope: AgentWorkspaceScope) {
    const response = decodeAgentWorkspacePreview(await invoke(command, { request }));
    for (const key of ["conversationId", "requestId", "manuscriptId", "contextSnapshotId"] as const) {
      if (response[key] !== scope[key].toLowerCase()) throw new AgentWorkspaceDecodeError();
    }
    return response;
  }
  return {
    prepare: (request) => receive("agent_prepare_writing_workspace", request, request.scope),
    restore: (request) => receive("agent_restore_writing_workspace", request, request),
    async approve(request) {
      const response = await receive("agent_approve_writing_workspace", request, request.scope);
      if (!response.approved || response.turnId !== request.turnId.toLowerCase() || response.leaseId !== request.leaseId.toLowerCase() || response.manifestHash !== request.manifestHash) throw new AgentWorkspaceDecodeError();
      return response;
    },
    async revoke(request) {
      if (await invoke("agent_revoke_writing_workspace", { request }) !== null) throw new AgentWorkspaceDecodeError();
    },
  };
}
