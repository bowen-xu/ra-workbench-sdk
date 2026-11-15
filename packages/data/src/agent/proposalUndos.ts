import { AgentWorkspaceDecodeError, decodeAgentApplicationScope, decodeAgentUndoRequest, decodeAgentUndoResponse,
  type AgentApplicationScope, type AgentUndoRequest, type AgentUndoResponse } from "@research-assistant/core/agent";
import type { AgentMetadataInvoke } from "./index";

/** Only the manuscript coordinator invokes undo while holding its complete lease. */
export function createAgentUndoGateway(invoke: AgentMetadataInvoke) {
  return { async find(value: AgentApplicationScope): Promise<AgentUndoResponse | null> {
    const scope = decodeAgentApplicationScope(value);
    const raw = await invoke("agent_find_writing_proposal_undo", { scope });
    if (raw === null) return null;
    const response = decodeAgentUndoResponse(raw);
    if (response.result?.kind !== "state") throw new AgentWorkspaceDecodeError();
    for (const key of ["conversationId", "manuscriptId", "proposalId", "operationId"] as const) {
      if (response.originalScope[key] !== scope[key]) throw new AgentWorkspaceDecodeError();
    }
    return response;
  }, async execute(value: AgentUndoRequest): Promise<AgentUndoResponse> {
    const request = decodeAgentUndoRequest(value);
    const response = decodeAgentUndoResponse(await invoke("agent_writing_proposal_undo", { request }));
    for (const key of ["conversationId", "manuscriptId", "proposalId", "operationId"] as const) {
      if (response.originalScope[key] !== request.scope[key]) throw new AgentWorkspaceDecodeError();
    }
    if (response.undoId !== request.undoId) throw new AgentWorkspaceDecodeError();
    const result = response.result, command = request.command;
    if (result === null) {
      if (command.action !== "read") throw new AgentWorkspaceDecodeError();
    } else if (result.kind === "edit") {
      if (command.action !== "prepareEditor" || JSON.stringify(result.expected) !== JSON.stringify(command.current)) throw new AgentWorkspaceDecodeError();
    } else if (command.action === "applyDisk" || command.action === "reconcileDisk") {
      const file = result.files.find(f => f.path === command.path);
      if (!file || file.target.kind !== "disk") throw new AgentWorkspaceDecodeError();
    } else if (command.action === "prepareEditor" || command.action === "confirmEditor") {
      const observation = command.action === "prepareEditor" ? command.current : command.actual;
      const file = result.files.find(f => f.path === observation.path);
      if (!file || file.target.kind !== "editor") throw new AgentWorkspaceDecodeError();
      if (command.action === "confirmEditor" && (file.phase !== "acknowledged"
        || file.target.sessionId !== observation.sessionId || file.target.resultRevision !== observation.revision)) throw new AgentWorkspaceDecodeError();
    } else if (command.action === "cancelPending" && result.status !== "rolledBack") {
      throw new AgentWorkspaceDecodeError();
    }
    return response;
  } };
}
