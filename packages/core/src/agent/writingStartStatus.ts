import {catalogOperationId} from "./catalogOperationDecoding";
import {decodeAgentCompactionStartRequest, type AgentCompactionStartRequest} from "./compaction";
import {decodeAgentSqlImmediateFailure, type AgentSqlImmediateDiagnostic} from "./sqlImmediateDiagnostic";
import {AgentSubmissionDecodeError, decodeAgentWritingStartResponse, type AgentSubmissionPreview,
  type AgentWritingStartRequest, type AgentWritingStartResponse} from "./submission";
import {decodeAgentWritingPrepareResult} from "./writingPreparation";

export interface AgentWritingStartDiagnostic extends AgentSqlImmediateDiagnostic {
  readonly operationId: string; readonly phase: string; readonly safeCause: string;
}
/** A read of existing frozen data/history. It proves neither the echoed mode nor
 * current permission or provider availability for a new execution. */
export type AgentWritingStartObservation = {readonly type: "started"; readonly result: AgentWritingStartResponse}
  | {readonly type: "prepared"; readonly preview: AgentSubmissionPreview}
  | {readonly type: "notFound"}
  | {readonly type: "unconfirmed"; readonly detail: AgentWritingStartDiagnostic};
export interface AgentWritingStartStatusResponse {
  readonly schemaVersion: 1; readonly intent: AgentWritingStartRequest; readonly status: AgentWritingStartObservation;
}
export interface AgentWritingCompactionStartStatusResponse {
  readonly schemaVersion: 1; readonly intent: AgentCompactionStartRequest; readonly status: AgentWritingStartObservation;
}
function fail(): never {throw new AgentSubmissionDecodeError();}
function fields(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const row = value as Record<string, unknown>;
  if (required.some(key => !Object.hasOwn(row, key)) || Object.keys(row).some(key => !required.includes(key) && !optional.includes(key))) return fail();
  return row;
}
function id(value: unknown): string {try {return catalogOperationId(value);} catch {return fail();}}
function text(value: unknown): string {return typeof value === "string" ? value : fail();}
export function decodeAgentWritingStartRequest(value: unknown): AgentWritingStartRequest {
  const row = fields(value, ["conversationId", "manuscriptId", "requestId", "contextSnapshotId", "model", "mode"]);
  if (row.mode !== "deepSeekNonThinking" && row.mode !== "chatGptDefault") return fail();
  // Native ModelIdentity ignores additional fields; only the start DTO denies
  // unknown fields. Admission still owns provider/model policy.
  if (!row.model || typeof row.model !== "object" || Array.isArray(row.model)) return fail();
  const model = row.model as Record<string, unknown>;
  return {conversationId: id(row.conversationId), manuscriptId: id(row.manuscriptId), requestId: id(row.requestId),
    contextSnapshotId: id(row.contextSnapshotId), mode: row.mode,
    model: {providerId: text(model.providerId), modelId: text(model.modelId), revision: model.revision == null ? null : text(model.revision)}};
}
export function sameAgentWritingStartRequest(a: AgentWritingStartRequest, b: AgentWritingStartRequest): boolean {
  return JSON.stringify(decodeAgentWritingStartRequest(a)) === JSON.stringify(decodeAgentWritingStartRequest(b));
}
export function sameAgentCompactionStartRequest(a: AgentCompactionStartRequest, b: AgentCompactionStartRequest): boolean {
  return JSON.stringify(decodeAgentCompactionStartRequest(a)) === JSON.stringify(decodeAgentCompactionStartRequest(b));
}
export const sameAgentWritingCompactionStartRequest = sameAgentCompactionStartRequest;
function observation(value: unknown, intent: AgentWritingStartRequest, compact: boolean): AgentWritingStartObservation {
  const status = fields(value, ["type"], ["result", "preview", "detail"]);
  if (status.type === "notFound") {fields(status, ["type"]); return {type: "notFound"};}
  if (status.type === "started") {
    fields(status, ["type", "result"]); const result = decodeAgentWritingStartResponse(status.result);
    if (!result.alreadyStarted || result.conversationId !== intent.conversationId || result.requestId !== intent.requestId) return fail();
    return {type: "started", result};
  }
  if (status.type === "prepared") {
    fields(status, ["type", "preview"]);
    const preview = decodeAgentWritingPrepareResult(status.preview, {...intent, context: {manuscriptId: intent.manuscriptId, files: []}});
    if (preview.contextSnapshotId !== intent.contextSnapshotId || JSON.stringify(preview.input.model) !== JSON.stringify(intent.model)
      || compact && preview.input.text.trim() !== "/compact") return fail();
    return {type: "prepared", preview};
  }
  if (status.type === "unconfirmed") {
    fields(status, ["type", "detail"]);
    const detail = fields(status.detail, ["operationId", "epoch", "sqlFence", "phase", "sqliteCode", "sqliteExtendedCode", "safeCause"]);
    const diagnostic = decodeAgentSqlImmediateFailure({code: "DATA_SQL_RECOVERY_REQUIRED", reason: detail})?.diagnostic;
    if (!diagnostic || id(diagnostic.operationId) !== intent.requestId || !diagnostic.phase || !diagnostic.safeCause
      || ["epoch", "sqlFence", "sqliteCode", "sqliteExtendedCode"].some(key => !Object.hasOwn(diagnostic, key))) return fail();
    return {type: "unconfirmed", detail: {...diagnostic, operationId: intent.requestId, phase: diagnostic.phase, safeCause: diagnostic.safeCause}};
  }
  return fail();
}
export function decodeAgentWritingStartStatusResponse(value: unknown): AgentWritingStartStatusResponse {
  const row = fields(value, ["schemaVersion", "intent", "status"]); if (row.schemaVersion !== 1) return fail();
  const intent = decodeAgentWritingStartRequest(row.intent);
  return {schemaVersion: 1, intent, status: observation(row.status, intent, false)};
}
export function decodeAgentWritingCompactionStartStatusResponse(value: unknown): AgentWritingCompactionStartStatusResponse {
  const row = fields(value, ["schemaVersion", "intent", "status"]); if (row.schemaVersion !== 1) return fail();
  const intent = decodeAgentCompactionStartRequest(row.intent);
  if (intent.host.kind !== "manuscript" || intent.expectedRevision > Number.MAX_SAFE_INTEGER) return fail();
  const ordinary: AgentWritingStartRequest = {...intent, manuscriptId: id(intent.host.manuscriptId), mode: "chatGptDefault"};
  return {schemaVersion: 1, intent, status: observation(row.status, ordinary, true)};
}
