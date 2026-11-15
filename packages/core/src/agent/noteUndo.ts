import { decodeAgentNoteApplication, type AgentNoteApplication } from "./noteApplication";
import type { AgentNoteReviewScope } from "./noteReview";
import { id, row } from "./workspaceDecoding";

export interface AgentNoteUndo extends AgentNoteReviewScope {
  readonly schemaVersion: 1;
  readonly undoId: string;
  readonly applicationId: string;
  readonly proposalId: string;
  readonly beforeRevision: number;
  readonly restoredRevision: number;
  readonly beforeHash: string;
  readonly restoredHash: string;
  readonly createdAt: string;
}
/** Bind a historical undo receipt to its original immutable application.
 * Neither record authorizes replacing the current editor contents. */
export function decodeAgentNoteUndo(value: unknown, original: AgentNoteApplication): AgentNoteUndo {
  const scope = {conversationId: original.conversationId, pageId: original.pageId, turnId: original.turnId, itemId: original.itemId};
  const application = decodeAgentNoteApplication(original, scope, original.proposalId);
  const r = row(value, ["schemaVersion", "undoId", "applicationId", "conversationId", "pageId", "turnId", "itemId", "proposalId", "beforeRevision", "restoredRevision", "beforeHash", "restoredHash", "createdAt"]);
  if (r.schemaVersion !== 1 || r.applicationId !== application.applicationId || r.proposalId !== application.proposalId
    || Object.entries(scope).some(([key, expected]) => r[key] !== expected)
    || application.appliedRevision >= Number.MAX_SAFE_INTEGER || r.beforeRevision !== application.appliedRevision
    || r.restoredRevision !== application.appliedRevision + 1
    || r.beforeHash !== application.afterHash || r.restoredHash !== application.beforeHash
    || typeof r.createdAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(r.createdAt)
    || !Number.isFinite(Date.parse(r.createdAt)) || new Date(r.createdAt).toISOString() !== r.createdAt) {
    throw new Error("Invalid note undo receipt");
  }
  return {schemaVersion: 1, ...scope, undoId: id(r.undoId), applicationId: application.applicationId,
    proposalId: application.proposalId, beforeRevision: application.appliedRevision, restoredRevision: application.appliedRevision + 1,
    beforeHash: application.afterHash, restoredHash: application.beforeHash, createdAt: r.createdAt};
}
