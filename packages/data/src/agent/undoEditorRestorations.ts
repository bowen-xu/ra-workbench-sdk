import { AgentWorkspaceDecodeError, decodeAgentApplicationScope, decodeAgentUndoEditorRestorationRequest,
  decodeAgentUndoEditorRestorationResponse, type AgentApplicationScope } from "@research-assistant/core/agent";
import { createAgentEditorRestorationGateway } from "./editorRestorations";
import type { AgentMetadataInvoke } from "./index";

/** Keep the existing restoration command/receipt checks and editor controller.
 * Only transport and the original-application binding differ for undo. */
export function createAgentUndoEditorRestorationGateway(invoke: AgentMetadataInvoke, value: AgentApplicationScope) {
  const originalScope = decodeAgentApplicationScope(value);
  return createAgentEditorRestorationGateway(async (_command, args) => {
    const request = decodeAgentUndoEditorRestorationRequest({originalScope, request: args.request});
    const response = decodeAgentUndoEditorRestorationResponse(await invoke("agent_writing_undo_editor_restoration", {request}));
    for (const key of ["conversationId", "manuscriptId", "proposalId", "operationId"] as const) {
      if (response.originalScope[key] !== originalScope[key]) throw new AgentWorkspaceDecodeError();
    }
    return response.result;
  });
}
