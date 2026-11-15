import { catalogOperationId } from "./catalogOperationDecoding";
import { decodeAgentNoteScope } from "./noteScope";
import { decodeAgentPaperQueueScope } from "./paperQueue";
import { decodeAgentRequestUserInput } from "./requestUserInput";
import { AgentSubmissionDecodeError, decodeAgentQueueCommand, decodeAgentWritingQueueScope,
  type AgentQueueCommand } from "./submission";

export type AgentQueueEditScope = { readonly kind: "manuscript"; readonly manuscriptId: string }
  | { readonly kind: "paper"; readonly paperId: string }
  | { readonly kind: "note" | "readingNote"; readonly resourceId: string }
  | { readonly kind: "context" };
export interface AgentQueueEditIntent extends AgentQueueCommand {
  readonly conversationId: string;
  readonly scope: AgentQueueEditScope;
  readonly expectedEpoch?: string;
}
export interface AgentContextQueueScope { readonly conversationId: string }
export interface AgentContextQueueEditRequest extends AgentContextQueueScope, AgentQueueCommand {readonly expectedEpoch?: string}

function fields(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AgentSubmissionDecodeError();
  const row = value as Record<string, unknown>;
  if (keys.length !== Object.keys(row).length || keys.some(key => !Object.hasOwn(row, key))) throw new AgentSubmissionDecodeError();
  return row;
}
export function decodeAgentContextQueueScope(value: unknown): AgentContextQueueScope {
  const row = fields(value, ["conversationId"]);
  return {conversationId: catalogOperationId(row.conversationId)};
}
export function decodeAgentContextQueueEditRequest(value: unknown): AgentContextQueueEditRequest {
  const intent = agentQueueEditIntentFromRequest(value);
  if (intent.scope.kind !== "context") throw new AgentSubmissionDecodeError();
  return {conversationId: intent.conversationId, requestId: intent.requestId, expectedRevision: intent.expectedRevision,
    ...(intent.expectedEpoch ? {expectedEpoch: intent.expectedEpoch} : {}), edit: intent.edit};
}
export function decodeAgentQueueEditScope(value: unknown, conversationId: string): AgentQueueEditScope {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AgentSubmissionDecodeError();
  const row = value as Record<string, unknown>;
  switch (row.kind) {
    case "manuscript": {
      fields(row, ["kind", "manuscriptId"]);
      return {kind: "manuscript", manuscriptId: decodeAgentWritingQueueScope({conversationId, manuscriptId: row.manuscriptId}).manuscriptId};
    }
    case "paper": {
      fields(row, ["kind", "paperId"]);
      return {kind: "paper", paperId: decodeAgentPaperQueueScope({conversationId, paperId: row.paperId}).paperId};
    }
    case "note": case "readingNote": return decodeAgentNoteScope({conversationId, scope: row}).scope;
    case "context": fields(row, ["kind"]); return {kind: "context"};
    default: throw new AgentSubmissionDecodeError();
  }
}
/** Used by the failure classifier too: no inferred, mixed or extra host dimensions. */
export function decodeAgentQueueEditRequestScope(value: unknown, conversationId: string): AgentQueueEditScope {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AgentSubmissionDecodeError();
  const row = value as Record<string, unknown>;
  const dimensions = ["manuscriptId", "paperId", "scope"].filter(key => Object.hasOwn(row, key));
  if (dimensions.length > 1) throw new AgentSubmissionDecodeError();
  const guarded = Object.hasOwn(row, "expectedEpoch");
  fields(row, ["conversationId", "requestId", "expectedRevision", "edit", ...dimensions, ...(guarded ? ["expectedEpoch"] : [])]);
  if (dimensions[0] === "manuscriptId") return decodeAgentQueueEditScope({kind: "manuscript", manuscriptId: row.manuscriptId}, conversationId);
  if (dimensions[0] === "paperId") return decodeAgentQueueEditScope({kind: "paper", paperId: row.paperId}, conversationId);
  return dimensions[0] === "scope" ? decodeAgentNoteScope({conversationId, scope: row.scope}).scope : {kind: "context"};
}
/** Decode the existing edit contract, preserving the original text and source URL bytes. */
export function decodeAgentQueueEditCommand(value: unknown): AgentQueueCommand {
  const row = fields(value, ["requestId", "expectedRevision", "edit"]);
  const edit = row.edit;
  if (edit && typeof edit === "object" && !Array.isArray(edit) && "type" in edit
    && (edit.type === "add" || edit.type === "update" || edit.type === "restore")) {
    const item = edit as Record<string, unknown>;
    if (typeof item.text !== "string") throw new AgentSubmissionDecodeError();
    const userInput = decodeAgentRequestUserInput(item.userInput, item.text);
    const command = decodeAgentQueueCommand({...row, edit: {...item, userInput}});
    return {...command, edit: {...command.edit, userInput}} as AgentQueueCommand;
  }
  return decodeAgentQueueCommand(row);
}
/** The original host request has no explicit context scope or derived origin/paused. */
export function agentQueueEditIntentFromRequest(value: unknown): AgentQueueEditIntent {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AgentSubmissionDecodeError();
  const row = value as Record<string, unknown>, conversationId = catalogOperationId(row.conversationId);
  const scope = decodeAgentQueueEditRequestScope(row, conversationId);
  const command = decodeAgentQueueEditCommand({requestId: row.requestId, expectedRevision: row.expectedRevision, edit: row.edit});
  return {conversationId, requestId: command.requestId, expectedRevision: command.expectedRevision,
    ...(Object.hasOwn(row, "expectedEpoch") ? {expectedEpoch: catalogOperationId(row.expectedEpoch)} : {}), scope, edit: command.edit};
}
/** Unified native echo; its explicit scope is different from the four request envelopes. */
export function decodeAgentQueueEditIntent(value: unknown): AgentQueueEditIntent {
  const guarded = !!value && typeof value === "object" && Object.hasOwn(value, "expectedEpoch");
  const row = fields(value, ["conversationId", "requestId", "expectedRevision", "scope", "edit", ...(guarded ? ["expectedEpoch"] : [])]);
  const conversationId = catalogOperationId(row.conversationId);
  const scope = decodeAgentQueueEditScope(row.scope, conversationId);
  const command = decodeAgentQueueEditCommand({requestId: row.requestId, expectedRevision: row.expectedRevision, edit: row.edit});
  return {conversationId, requestId: command.requestId, expectedRevision: command.expectedRevision,
    ...(guarded ? {expectedEpoch: catalogOperationId(row.expectedEpoch)} : {}), scope, edit: command.edit};
}
