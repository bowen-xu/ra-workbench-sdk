import {decodeAgentNoteReviewScope,decodeAgentNoteRejection,decodeAgentNoteDecisionId,decodeAgentNoteProposalId,type AgentNoteReviewScope,type AgentNoteRejection} from "@research-assistant/core/agent";
import type {AgentMetadataInvoke} from "./index";
export interface AgentNoteRejectionGateway {
  status(scope:AgentNoteReviewScope,proposalId:string):Promise<AgentNoteRejection|null>;
  reject(scope:AgentNoteReviewScope,requestId:string,proposalId:string):Promise<AgentNoteRejection>;
}
export function createAgentNoteRejectionGateway(invoke:AgentMetadataInvoke):AgentNoteRejectionGateway {
  return {
    async status(scope,proposalId) {
      const expected=decodeAgentNoteReviewScope(scope);
      decodeAgentNoteProposalId(proposalId);
      const result=await invoke("agent_note_rejection_status",{request:{...expected}});
      return result===null?null:decodeAgentNoteRejection(result,expected,proposalId);
    },
    async reject(scope,requestId,proposalId) {
      const expected=decodeAgentNoteReviewScope(scope);
      decodeAgentNoteProposalId(proposalId);
      const request={scope:{...expected},requestId:decodeAgentNoteDecisionId(requestId)};
      return decodeAgentNoteRejection(await invoke("agent_reject_note_rewrite",{request}),expected,proposalId);
    },
  };
}
