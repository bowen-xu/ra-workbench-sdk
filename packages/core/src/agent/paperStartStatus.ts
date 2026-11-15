import {catalogOperationId} from "./catalogOperationDecoding";
import {decodeAgentSqlImmediateFailure, type AgentSqlImmediateDiagnostic} from "./sqlImmediateDiagnostic";
import {AgentPaperSubmissionDecodeError, decodeAgentPaperSubmissionReceipt} from "./paperSubmission";
import {decodeAgentStartResponse, type AgentExecutionMode, type AgentStartResponse} from "./submission";
import type {AgentModelIdentity} from "./events";

export interface AgentPaperStartRequest {
  readonly conversationId: string; readonly requestId: string; readonly paperId: string; readonly paperContextSnapshotId: string;
  readonly contextSnapshotId: string; readonly model: AgentModelIdentity; readonly mode: AgentExecutionMode;
}
export interface AgentPaperStartStatusResponse {
  readonly schemaVersion: 1; readonly intent: AgentPaperStartRequest;
  readonly status: {readonly type: "started"; readonly result: AgentStartResponse}
    | {readonly type: "unconfirmed"; readonly detail: AgentSqlImmediateDiagnostic};
}
function fail(): never {throw new AgentPaperSubmissionDecodeError();}
function fields(value: unknown, names: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const row = value as Record<string, unknown>;
  if (names.some(name => !Object.hasOwn(row, name)) || Object.keys(row).some(name => !names.includes(name))) return fail();
  return row;
}
function id(value: unknown): string {try {return catalogOperationId(value);} catch {return fail();}}
function text(value: unknown): string {return typeof value === "string" ? value : fail();}
export function decodeAgentPaperStartRequest(value: unknown): AgentPaperStartRequest {
  const row = fields(value, ["conversationId", "requestId", "paperId", "paperContextSnapshotId", "contextSnapshotId", "model", "mode"]);
  if (row.mode !== "deepSeekNonThinking" && row.mode !== "chatGptDefault") return fail();
  const receipt = decodeAgentPaperSubmissionReceipt({conversationId: id(row.conversationId), requestId: id(row.requestId),
    paperId: row.paperId, paperContextSnapshotId: row.paperContextSnapshotId});
  if (!row.model || typeof row.model !== "object" || Array.isArray(row.model)) return fail();
  const model = row.model as Record<string, unknown>;
  return {...receipt, contextSnapshotId: id(row.contextSnapshotId),
    model: {providerId: text(model.providerId), modelId: text(model.modelId), revision: model.revision == null ? null : text(model.revision)}, mode: row.mode};
}
export function sameAgentPaperStartRequest(a: AgentPaperStartRequest, b: AgentPaperStartRequest): boolean {
  return JSON.stringify(decodeAgentPaperStartRequest(a)) === JSON.stringify(decodeAgentPaperStartRequest(b));
}
export function decodeAgentPaperStartStatusResponse(value: unknown): AgentPaperStartStatusResponse {
  const row = fields(value, ["schemaVersion", "intent", "status"]); if (row.schemaVersion !== 1) return fail();
  const intent = decodeAgentPaperStartRequest(row.intent);
  if (!row.status || typeof row.status !== "object" || Array.isArray(row.status)) return fail();
  const status = row.status as Record<string, unknown>;
  if (status.type === "started") {
    fields(status, ["type", "result"]); const result = decodeAgentStartResponse(status.result);
    if (!result.alreadyStarted || result.conversationId !== intent.conversationId || result.requestId !== intent.requestId) return fail();
    return {schemaVersion: 1, intent, status: {type: "started", result}};
  }
  if (status.type !== "unconfirmed") return fail();
  fields(status, ["type", "detail"]);
  const detail = fields(status.detail, ["operationId", "epoch", "sqlFence", "phase", "sqliteCode", "sqliteExtendedCode", "safeCause"]);
  const diagnostic = decodeAgentSqlImmediateFailure({code: "DATA_SQL_RECOVERY_REQUIRED", reason: detail})?.diagnostic;
  if (!diagnostic || id(diagnostic.operationId) !== intent.requestId || !diagnostic.phase || !diagnostic.safeCause
    || ["epoch", "sqlFence", "sqliteCode", "sqliteExtendedCode"].some(key => !Object.hasOwn(diagnostic, key))) return fail();
  return {schemaVersion: 1, intent, status: {type: "unconfirmed", detail: diagnostic}};
}
