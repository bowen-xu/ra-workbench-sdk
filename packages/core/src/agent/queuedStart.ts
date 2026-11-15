import {catalogOperationId} from "./catalogOperationDecoding";
import {decodeAgentSqlImmediateFailure, type AgentSqlImmediateDiagnostic} from "./sqlImmediateDiagnostic";
import {decodeAgentWritingStartRequest} from "./writingStartStatus";
import {AgentSubmissionDecodeError, decodeAgentSubmissionPreview, decodeAgentWritingStartResponse,
  type AgentSubmissionPreview, type AgentWritingQueuedStartRequest, type AgentWritingStartResponse} from "./submission";

export interface AgentWritingQueuedStartDiagnostic extends AgentSqlImmediateDiagnostic {
  readonly operationId: string; readonly phase: string; readonly safeCause: string;
}
/** These are observations of an existing record/admission/history, not a new
 * SQL proof binding mode or permission to execute a model. */
export interface AgentWritingQueuedStartStatusResponse {
  readonly schemaVersion: 1;
  readonly intent: AgentWritingQueuedStartRequest;
  readonly status: {readonly type: "prepared" | "admitted"; readonly preview: AgentSubmissionPreview}
    | {readonly type: "started"; readonly result: AgentWritingStartResponse}
    | {readonly type: "notFound"}
    | {readonly type: "unconfirmed"; readonly detail: AgentWritingQueuedStartDiagnostic};
}
function fail(): never {throw new AgentSubmissionDecodeError();}
function fields(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const row = value as Record<string, unknown>;
  if (required.some(key => !Object.hasOwn(row, key)) || Object.keys(row).some(key => !required.includes(key) && !optional.includes(key))) return fail();
  return row;
}
function id(value: unknown): string {try {return catalogOperationId(value);} catch {return fail();}}
export function decodeAgentWritingQueuedStartRequest(value: unknown): AgentWritingQueuedStartRequest {
  const row = fields(value, ["inputId", "expectedRevision", "start"]);
  if (typeof row.expectedRevision !== "number" || !Number.isSafeInteger(row.expectedRevision) || row.expectedRevision < 0 || row.expectedRevision >= Number.MAX_SAFE_INTEGER) return fail();
  const start = fields(row.start, ["conversationId", "manuscriptId", "requestId", "contextSnapshotId", "model", "mode"]);
  // Keep the deployed queue envelope's exact model-field contract while sharing
  // canonical start identity decoding with ordinary status observation.
  fields(start.model, ["providerId", "modelId"], ["revision"]);
  return {inputId: id(row.inputId), expectedRevision: row.expectedRevision, start: decodeAgentWritingStartRequest(start)};
}
export function sameAgentWritingQueuedStartRequest(a: AgentWritingQueuedStartRequest, b: AgentWritingQueuedStartRequest): boolean {
  return JSON.stringify(decodeAgentWritingQueuedStartRequest(a)) === JSON.stringify(decodeAgentWritingQueuedStartRequest(b));
}
export function decodeAgentWritingQueuedStartStatusResponse(value: unknown): AgentWritingQueuedStartStatusResponse {
  const row = fields(value, ["schemaVersion", "intent", "status"]);
  if (row.schemaVersion !== 1) return fail();
  const intent = decodeAgentWritingQueuedStartRequest(row.intent), status = fields(row.status, ["type"], ["preview", "result", "detail"]);
  if (status.type === "notFound") {fields(status, ["type"]); return {schemaVersion: 1, intent, status: {type: "notFound"}};}
  if (status.type === "prepared" || status.type === "admitted") {
    fields(status, ["type", "preview"]); const preview = decodeAgentSubmissionPreview(status.preview), start = intent.start;
    if (preview.conversationId !== start.conversationId || preview.manuscriptId !== start.manuscriptId || preview.requestId !== start.requestId
      || preview.contextSnapshotId !== start.contextSnapshotId || JSON.stringify(preview.input.model) !== JSON.stringify(start.model)) return fail();
    return {schemaVersion: 1, intent, status: {type: status.type, preview}};
  }
  if (status.type === "started") {
    fields(status, ["type", "result"]); const result = decodeAgentWritingStartResponse(status.result);
    if (!result.alreadyStarted || result.conversationId !== intent.start.conversationId || result.requestId !== intent.start.requestId) return fail();
    return {schemaVersion: 1, intent, status: {type: "started", result}};
  }
  if (status.type === "unconfirmed") {
    fields(status, ["type", "detail"]);
    const detail = fields(status.detail, ["operationId", "epoch", "sqlFence", "phase", "sqliteCode", "sqliteExtendedCode", "safeCause"]);
    const diagnostic = decodeAgentSqlImmediateFailure({code: "DATA_SQL_RECOVERY_REQUIRED", reason: detail})?.diagnostic;
    if (!diagnostic || id(diagnostic.operationId) !== intent.start.requestId || !diagnostic.phase || !diagnostic.safeCause
      || ["epoch", "sqlFence", "sqliteCode", "sqliteExtendedCode"].some(key => !Object.hasOwn(diagnostic, key))) return fail();
    return {schemaVersion: 1, intent, status: {type: "unconfirmed", detail: {...diagnostic, operationId: intent.start.requestId, phase: diagnostic.phase, safeCause: diagnostic.safeCause}}};
  }
  return fail();
}
