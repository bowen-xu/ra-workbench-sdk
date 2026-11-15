import { AgentWorkspaceDecodeError, decodeAgentWorkspaceDiscardRecovery, decodeAgentWorkspaceDiscardPreview, type AgentWorkspaceScope,
  type AgentWorkspaceDiscardRecovery, type AgentWorkspaceDiscardPreview, type AgentWorkspaceDiscardConfirmation } from "@research-assistant/core/agent";
import type { AgentMetadataInvoke } from "./index";

export interface AgentWorkspaceDiscardGateway {
  find(request: AgentWorkspaceScope): Promise<AgentWorkspaceDiscardRecovery | null>;
  preview(request: AgentWorkspaceScope): Promise<AgentWorkspaceDiscardPreview>;
  discard(request: AgentWorkspaceDiscardConfirmation): Promise<AgentWorkspaceDiscardRecovery>;
}

export function createAgentWorkspaceDiscardGateway(invoke: AgentMetadataInvoke): AgentWorkspaceDiscardGateway {
  return {
    async preview(request) {
      const scope = { ...request };
      return decodeAgentWorkspaceDiscardPreview(await invoke("agent_preview_writing_workspace_discard", { request: scope }), scope);
    },
    async discard(request) {
      const frozen = { operationId: request.operationId, environmentId: request.environmentId, inventoryHash: request.inventoryHash,
        binding: { ...request.binding, scope: { ...request.binding.scope } } };
      const expected = decodeAgentWorkspaceDiscardRecovery({ ...frozen, schemaVersion: 1, state: "complete" }, frozen.binding.scope);
      const result = decodeAgentWorkspaceDiscardRecovery(await invoke("agent_discard_writing_workspace", { request: frozen }), frozen.binding.scope);
      if (!result || JSON.stringify(result) !== JSON.stringify(expected)) throw new AgentWorkspaceDecodeError();
      return result;
    },
    async find(request) {
      const scope = { ...request };
      const response = await invoke("agent_find_writing_workspace_discard", { request: scope });
      return decodeAgentWorkspaceDiscardRecovery(response, scope);
    },
  };
}
