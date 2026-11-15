import { agentSqlFence, catalogOperationId } from "./catalogOperationDecoding";
import { agentQueueEditIntentFromRequest, decodeAgentQueueEditIntent, type AgentQueueEditIntent } from "./queueEditIntent";
import { decodeAgentSqlImmediateFailure, type AgentSqlImmediateDiagnostic } from "./sqlImmediateDiagnostic";
import { AgentSubmissionDecodeError, decodeAgentQueueState, type AgentQueueState } from "./submission";

export const AGENT_INPUT_QUEUE_EDIT_FAMILY = "agent.input_queue.edit";
export interface AgentQueueEditProof {
  readonly schemaVersion: 1;
  readonly operationId: string;
  readonly conversationId: string;
  readonly family: typeof AGENT_INPUT_QUEUE_EDIT_FAMILY;
  readonly epoch: string;
  readonly sqlFence: string;
  readonly replayed: boolean;
  readonly result: null;
}
export interface AgentQueueEditDiagnostic extends AgentSqlImmediateDiagnostic {
  readonly operationId: string;
  readonly epoch: string | null;
  readonly sqlFence: string | null;
  readonly phase: string;
  readonly sqliteCode: string | null;
  readonly sqliteExtendedCode: number | null;
  readonly safeCause: string;
}
export interface AgentQueueEditStatusResponse {
  readonly schemaVersion: 1;
  readonly intent: AgentQueueEditIntent;
  readonly status:
    | {readonly type: "committed"; readonly queue: AgentQueueState; readonly proof: AgentQueueEditProof}
    | {readonly type: "deleted"; readonly proof: AgentQueueEditProof; readonly detail: AgentQueueEditDiagnostic}
    | {readonly type: "notFound"}
    | {readonly type: "unconfirmed"; readonly detail: AgentQueueEditDiagnostic};
}
function fail(): never { throw new AgentSubmissionDecodeError(); }
function fields(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== keys.length || keys.some(key => !Object.hasOwn(row, key))) return fail();
  return row;
}
export function decodeAgentQueueEditProof(value: unknown): AgentQueueEditProof {
  const row = fields(value, ["schemaVersion", "operationId", "conversationId", "family", "epoch", "sqlFence", "replayed", "result"]);
  if (row.schemaVersion !== 1 || row.family !== AGENT_INPUT_QUEUE_EDIT_FAMILY || row.result !== null || typeof row.replayed !== "boolean") return fail();
  return {schemaVersion: 1, operationId: catalogOperationId(row.operationId), conversationId: catalogOperationId(row.conversationId),
    family: AGENT_INPUT_QUEUE_EDIT_FAMILY, epoch: catalogOperationId(row.epoch), sqlFence: agentSqlFence(row.sqlFence), replayed: row.replayed, result: null};
}
function diagnostic(value: unknown, requestId: string): AgentQueueEditDiagnostic {
  const raw = fields(value, ["operationId", "epoch", "sqlFence", "phase", "sqliteCode", "sqliteExtendedCode", "safeCause"]);
  if (catalogOperationId(raw.operationId) !== requestId) return fail();
  const detail = decodeAgentSqlImmediateFailure({code: "DATA_SQL_RECOVERY_REQUIRED", reason: raw})?.diagnostic;
  if (!detail || !detail.phase || !detail.safeCause || detail.epoch === undefined || detail.sqlFence === undefined
    || detail.sqliteCode === undefined || detail.sqliteExtendedCode === undefined) return fail();
  return {operationId: requestId, epoch: detail.epoch, sqlFence: detail.sqlFence, phase: detail.phase,
    sqliteCode: detail.sqliteCode, sqliteExtendedCode: detail.sqliteExtendedCode, safeCause: detail.safeCause};
}
function proof(value: unknown, intent: AgentQueueEditIntent): AgentQueueEditProof {
  const result = decodeAgentQueueEditProof(value);
  if (result.operationId !== intent.requestId || result.conversationId !== intent.conversationId
    || intent.expectedEpoch !== undefined && result.epoch !== intent.expectedEpoch) return fail();
  return result;
}
/** The caller supplies its complete original host request, never just C/R or current Q. */
export function decodeAgentQueueEditStatusResponse(value: unknown, originalRequest: unknown): AgentQueueEditStatusResponse {
  const row = fields(value, ["schemaVersion", "intent", "status"]);
  if (row.schemaVersion !== 1) return fail();
  const intent = decodeAgentQueueEditIntent(row.intent), expected = agentQueueEditIntentFromRequest(originalRequest);
  if (JSON.stringify(intent) !== JSON.stringify(expected) || !row.status || typeof row.status !== "object" || !("type" in row.status)) return fail();
  switch (row.status.type) {
    case "committed": {
      const status = fields(row.status, ["type", "queue", "proof"]), queue = decodeAgentQueueState(status.queue);
      if (queue.conversationId !== intent.conversationId || queue.revision !== intent.expectedRevision + 1) return fail();
      return {schemaVersion: 1, intent, status: {type: "committed", queue, proof: proof(status.proof, intent)}};
    }
    case "deleted": {
      const status = fields(row.status, ["type", "proof", "detail"]);
      return {schemaVersion: 1, intent, status: {type: "deleted", proof: proof(status.proof, intent), detail: diagnostic(status.detail, intent.requestId)}};
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
