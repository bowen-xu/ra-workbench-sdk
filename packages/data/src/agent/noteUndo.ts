import { decodeAgentNoteApplication, decodeAgentNoteDecisionId, decodeAgentNoteExpectedRevision, decodeAgentNoteUndo,
  type AgentNoteApplication, type AgentNoteUndo } from "@research-assistant/core/agent";
import type { AgentMetadataInvoke } from "./index";

export interface AgentNoteUndoGateway {
  status(application: AgentNoteApplication): Promise<AgentNoteUndo | null>;
  undo(application: AgentNoteApplication, requestId: string): Promise<AgentNoteUndo>;
}
function capture(original: AgentNoteApplication) {
  const scope = {conversationId: original.conversationId, pageId: original.pageId, turnId: original.turnId, itemId: original.itemId};
  return {scope, application: decodeAgentNoteApplication(original, scope, original.proposalId)};
}
export function createAgentNoteUndoGateway(invoke: AgentMetadataInvoke): AgentNoteUndoGateway {
  return {
    async status(original) {
      const {scope, application} = capture(original);
      const result = await invoke("agent_note_undo_status", {request: scope});
      return result === null ? null : decodeAgentNoteUndo(result, application);
    },
    async undo(original, requestId) {
      const {scope, application} = capture(original);
      const expectedRevision = decodeAgentNoteExpectedRevision(application.appliedRevision);
      const request = {scope, applicationId: application.applicationId, requestId: decodeAgentNoteDecisionId(requestId), expectedRevision};
      return decodeAgentNoteUndo(await invoke("agent_undo_note_rewrite", {request}), application);
    },
  };
}
