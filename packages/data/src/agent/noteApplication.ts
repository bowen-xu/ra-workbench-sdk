import {
  decodeAgentNoteApplication, decodeAgentNoteDecisionId, decodeAgentNoteExpectedRevision,
  decodeAgentNoteProposalId, decodeAgentNoteReviewScope,
  type AgentNoteApplication, type AgentNoteReviewScope,
} from "@research-assistant/core/agent";
import type { AgentMetadataInvoke } from "./index";

export interface AgentNoteApplicationGateway {
  status(scope: AgentNoteReviewScope, proposalId: string): Promise<AgentNoteApplication | null>;
  accept(scope: AgentNoteReviewScope, requestId: string, proposalId: string, expectedRevision: number): Promise<AgentNoteApplication>;
}

export function createAgentNoteApplicationGateway(invoke: AgentMetadataInvoke): AgentNoteApplicationGateway {
  return {
    async status(scope, proposalId) {
      const expected = decodeAgentNoteReviewScope(scope);
      decodeAgentNoteProposalId(proposalId);
      const result = await invoke("agent_note_application_status", {request: {...expected}});
      return result === null ? null : decodeAgentNoteApplication(result, expected, proposalId);
    },
    async accept(scope, requestId, proposalId, expectedRevision) {
      const expected = decodeAgentNoteReviewScope(scope);
      decodeAgentNoteProposalId(proposalId);
      const revision = decodeAgentNoteExpectedRevision(expectedRevision);
      const request = {scope: {...expected}, requestId: decodeAgentNoteDecisionId(requestId), expectedRevision: revision};
      const receipt = decodeAgentNoteApplication(await invoke("agent_accept_note_rewrite", {request}), expected, proposalId);
      if (receipt.beforeRevision !== revision) throw new Error("Note application revision does not match its request");
      return receipt;
    },
  };
}
