import { decodeAgentNoteReviewScope, type AgentNoteReviewScope } from "./noteReview";
import { id, row } from "./workspaceDecoding";

export interface AgentNoteRejection extends AgentNoteReviewScope {
  readonly schemaVersion: 1;
  readonly decisionId: string;
  readonly proposalId: string;
  readonly createdAt: string;
}
export class AgentNoteRejectionDecodeError extends Error {
  constructor() { super("Invalid note rejection receipt"); this.name="AgentNoteRejectionDecodeError"; }
}
export function decodeAgentNoteRejection(value:unknown,scope:AgentNoteReviewScope,proposalId:string):AgentNoteRejection {
  try {
    const expected=decodeAgentNoteReviewScope(scope);
    const r=row(value,["schemaVersion","decisionId","conversationId","pageId","turnId","itemId","proposalId","createdAt"]);
    if(r.schemaVersion!==1 || !/^note-rewrite:[0-9a-f]{64}$/.test(proposalId) || r.proposalId!==proposalId
      || Object.entries(expected).some(([key,value])=>r[key]!==value)
      || typeof r.createdAt!=="string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(r.createdAt)
      || !Number.isFinite(Date.parse(r.createdAt)) || new Date(r.createdAt).toISOString()!==r.createdAt) throw new AgentNoteRejectionDecodeError();
    return {schemaVersion:1,...expected,decisionId:id(r.decisionId),proposalId,createdAt:r.createdAt};
  } catch { throw new AgentNoteRejectionDecodeError(); }
}
export function decodeAgentNoteDecisionId(value:unknown):string {
  try { return id(value); } catch { throw new AgentNoteRejectionDecodeError(); }
}

export function decodeAgentNoteProposalId(value:unknown):string {
  if(typeof value!=="string" || !/^note-rewrite:[0-9a-f]{64}$/.test(value))throw new AgentNoteRejectionDecodeError();
  return value;
}
