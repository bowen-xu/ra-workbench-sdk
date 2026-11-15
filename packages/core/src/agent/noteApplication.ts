import { decodeAgentNoteReviewScope, type AgentNoteReviewScope } from "./noteReview";
import { decodeAgentNoteProposalId } from "./noteRejection";
import { id, row } from "./workspaceDecoding";

export interface AgentNoteApplication extends AgentNoteReviewScope {
  readonly schemaVersion: 1;
  readonly applicationId: string;
  readonly proposalId: string;
  readonly beforeRevision: number;
  readonly appliedRevision: number;
  readonly beforeHash: string;
  readonly afterHash: string;
  readonly createdAt: string;
}

export class AgentNoteApplicationDecodeError extends Error {
  constructor() { super("Invalid note application receipt"); this.name = "AgentNoteApplicationDecodeError"; }
}

export function decodeAgentNoteExpectedRevision(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value >= Number.MAX_SAFE_INTEGER) {
    throw new AgentNoteApplicationDecodeError();
  }
  return value;
}

/** A durable historical receipt, never a document snapshot or permission to
 * replace the current editor. Bind it to the proposal before exposing it. */
export function decodeAgentNoteApplication(value: unknown, scope: AgentNoteReviewScope, proposalId: string): AgentNoteApplication {
  try {
    const expected = decodeAgentNoteReviewScope(scope);
    decodeAgentNoteProposalId(proposalId);
    const r = row(value, ["schemaVersion", "applicationId", "conversationId", "pageId", "turnId", "itemId", "proposalId", "beforeRevision", "appliedRevision", "beforeHash", "afterHash", "createdAt"]);
    const beforeRevision = decodeAgentNoteExpectedRevision(r.beforeRevision);
    if (r.schemaVersion !== 1 || r.proposalId !== proposalId
      || Object.entries(expected).some(([key, item]) => r[key] !== item)
      || r.appliedRevision !== beforeRevision + 1
      || typeof r.beforeHash !== "string" || !/^[0-9a-f]{64}$/.test(r.beforeHash)
      || typeof r.afterHash !== "string" || !/^[0-9a-f]{64}$/.test(r.afterHash) || r.afterHash === r.beforeHash
      || typeof r.createdAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(r.createdAt)
      || !Number.isFinite(Date.parse(r.createdAt)) || new Date(r.createdAt).toISOString() !== r.createdAt) {
      throw new AgentNoteApplicationDecodeError();
    }
    return {schemaVersion: 1, ...expected, applicationId: id(r.applicationId), proposalId,
      beforeRevision, appliedRevision: beforeRevision + 1, beforeHash: r.beforeHash, afterHash: r.afterHash, createdAt: r.createdAt};
  } catch { throw new AgentNoteApplicationDecodeError(); }
}
