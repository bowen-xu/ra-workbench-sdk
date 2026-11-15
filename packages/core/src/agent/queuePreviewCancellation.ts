import { catalogOperationId, agentSqlFence } from "./catalogOperationDecoding";
import { decodeAgentSqlImmediateFailure, type AgentSqlImmediateDiagnostic } from "./sqlImmediateDiagnostic";
import { AgentSubmissionDecodeError, decodeAgentWritingQueueResponse,
  type AgentWritingQueueCancelRequest, type AgentWritingQueueResponse } from "./submission";

export const AGENT_QUEUE_PREVIEW_CANCEL_FAMILY = "agent.queue.preview.cancel";

/** Evidence for the original cancellation, never the current queue view. */
export interface AgentWritingQueueCancelProof {
  readonly schemaVersion: 1;
  readonly operationId: string;
  readonly conversationId: string;
  readonly family: typeof AGENT_QUEUE_PREVIEW_CANCEL_FAMILY;
  readonly epoch: string;
  readonly sqlFence: string;
  readonly replayed: boolean;
  readonly result: null;
}
export interface AgentWritingQueueCancelDiagnostic extends AgentSqlImmediateDiagnostic {
  readonly operationId: string;
  readonly phase: string;
  readonly safeCause: string;
}
export interface AgentWritingQueueCancelStatusResponse {
  readonly schemaVersion: 1;
  readonly intent: AgentWritingQueueCancelRequest;
  readonly status:
    | { readonly type: "committed"; readonly proof: AgentWritingQueueCancelProof; readonly queue: AgentWritingQueueResponse }
    | { readonly type: "notFound" }
    | { readonly type: "unconfirmed"; readonly detail: AgentWritingQueueCancelDiagnostic };
}
function fail(): never { throw new AgentSubmissionDecodeError(); }
function fields(value: unknown, names: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== names.length || names.some(name => !Object.hasOwn(row, name))) return fail();
  return row;
}
function id(value: unknown): string {
  try { return catalogOperationId(value); } catch { return fail(); }
}
function fence(value: unknown): string {
  try { return agentSqlFence(value); } catch { return fail(); }
}
export function decodeAgentWritingQueueCancelRequest(value: unknown): AgentWritingQueueCancelRequest {
  const row = fields(value, ["conversationId", "manuscriptId", "requestId", "expectedRevision", "inputId", "previewRequestId"]);
  if (typeof row.expectedRevision !== "number" || !Number.isSafeInteger(row.expectedRevision)
    || row.expectedRevision < 0 || row.expectedRevision >= Number.MAX_SAFE_INTEGER) return fail();
  return {conversationId: id(row.conversationId), manuscriptId: id(row.manuscriptId), requestId: id(row.requestId),
    expectedRevision: row.expectedRevision, inputId: id(row.inputId), previewRequestId: id(row.previewRequestId)};
}
export function decodeAgentWritingQueueCancelProof(value: unknown): AgentWritingQueueCancelProof {
  const row = fields(value, ["schemaVersion", "operationId", "conversationId", "family", "epoch", "sqlFence", "replayed", "result"]);
  if (row.schemaVersion !== 1 || row.family !== AGENT_QUEUE_PREVIEW_CANCEL_FAMILY || row.result !== null || typeof row.replayed !== "boolean") return fail();
  return {schemaVersion: 1, operationId: id(row.operationId), conversationId: id(row.conversationId),
    family: AGENT_QUEUE_PREVIEW_CANCEL_FAMILY, epoch: id(row.epoch), sqlFence: fence(row.sqlFence), replayed: row.replayed, result: null};
}
export function decodeAgentWritingQueueCancelResult(value: unknown, intent: AgentWritingQueueCancelRequest): AgentWritingQueueResponse {
  const queue = decodeAgentWritingQueueResponse(value);
  if (queue.conversationId !== intent.conversationId || queue.manuscriptId !== intent.manuscriptId
    || queue.revision !== intent.expectedRevision + 1 || queue.preparingInputId !== null || !queue.paused
    || !queue.inputs.some(input => input.inputId === intent.inputId)) return fail();
  return queue;
}
function diagnostic(value: unknown, operationId: string): AgentWritingQueueCancelDiagnostic {
  const row = fields(value, ["operationId", "epoch", "sqlFence", "phase", "sqliteCode", "sqliteExtendedCode", "safeCause"]);
  const result = decodeAgentSqlImmediateFailure({code: "DATA_SQL_RECOVERY_REQUIRED", reason: row})?.diagnostic;
  if (!result || id(result.operationId) !== operationId || !result.phase || !result.safeCause
    || !Object.hasOwn(result, "epoch") || !Object.hasOwn(result, "sqlFence")
    || !Object.hasOwn(result, "sqliteCode") || !Object.hasOwn(result, "sqliteExtendedCode")) return fail();
  return {...result, operationId, phase: result.phase, safeCause: result.safeCause};
}
export function decodeAgentWritingQueueCancelStatusResponse(value: unknown): AgentWritingQueueCancelStatusResponse {
  const row = fields(value, ["schemaVersion", "intent", "status"]);
  if (row.schemaVersion !== 1) return fail();
  const intent = decodeAgentWritingQueueCancelRequest(row.intent);
  if (!row.status || typeof row.status !== "object" || !("type" in row.status)) return fail();
  switch (row.status.type) {
    case "committed": {
      const status = fields(row.status, ["type", "proof", "queue"]), proof = decodeAgentWritingQueueCancelProof(status.proof);
      if (proof.operationId !== intent.requestId || proof.conversationId !== intent.conversationId) return fail();
      return {schemaVersion: 1, intent, status: {type: "committed", proof, queue: decodeAgentWritingQueueCancelResult(status.queue, intent)}};
    }
    case "notFound":
      fields(row.status, ["type"]); return {schemaVersion: 1, intent, status: {type: "notFound"}};
    case "unconfirmed": {
      const status = fields(row.status, ["type", "detail"]);
      return {schemaVersion: 1, intent, status: {type: "unconfirmed", detail: diagnostic(status.detail, intent.requestId)}};
    }
    default: return fail();
  }
}
