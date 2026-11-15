import { AgentSubmissionDecodeError, decodeAgentQueueCommand, decodeAgentQueueState,
  type AgentQueueCommand, type AgentQueueState } from "./submission";
import { isAgentPaperQueueId } from "./paperQueueIdentity";

export interface AgentPaperQueueScope {
  readonly conversationId: string;
  readonly paperId: string;
}
export interface AgentPaperQueueResponse extends AgentPaperQueueScope, AgentQueueState {}
export interface AgentPaperQueueEditRequest extends AgentPaperQueueScope, AgentQueueCommand {readonly expectedEpoch?: string}

function fail(): never { throw new AgentSubmissionDecodeError(); }
function id(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)
    || value === "00000000-0000-0000-0000-000000000000") return fail();
  return value.toLowerCase();
}
function paper(value: unknown): string {
  if (!isAgentPaperQueueId(value)) return fail();
  return value;
}
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== keys.length || keys.some((key) => !Object.hasOwn(row, key))) return fail();
  return row;
}

export function decodeAgentPaperQueueScope(value: unknown): AgentPaperQueueScope {
  const row = object(value, ["conversationId", "paperId"]);
  return { conversationId: id(row.conversationId), paperId: paper(row.paperId) };
}
export function decodeAgentPaperQueueEditRequest(value: unknown): AgentPaperQueueEditRequest {
  const guarded = !!value && typeof value === "object" && Object.hasOwn(value, "expectedEpoch");
  const row = object(value, ["conversationId", "paperId", "requestId", "expectedRevision", "edit", ...(guarded ? ["expectedEpoch"] : [])]);
  return { ...decodeAgentPaperQueueScope({ conversationId: row.conversationId, paperId: row.paperId }),
    ...decodeAgentQueueCommand({ requestId: row.requestId, expectedRevision: row.expectedRevision, edit: row.edit }),
    ...(guarded ? {expectedEpoch: id(row.expectedEpoch)} : {}) };
}
export function decodeAgentPaperQueueResponse(value: unknown): AgentPaperQueueResponse {
  const row = object(value, ["schemaVersion", "conversationId", "paperId", "revision", "paused", "preparingInputId", "inputs"]);
  const state = decodeAgentQueueState({ schemaVersion: row.schemaVersion, conversationId: row.conversationId,
    revision: row.revision, paused: row.paused, preparingInputId: row.preparingInputId, inputs: row.inputs });
  const scope = decodeAgentPaperQueueScope({ conversationId: row.conversationId, paperId: row.paperId });
  if (state.conversationId !== scope.conversationId) return fail();
  return { ...scope, ...state };
}
