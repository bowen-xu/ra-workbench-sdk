import {catalogOperationId} from "./catalogOperationDecoding";
import {decodeAgentContextPreview, decodeAgentContextQueueConfirmation, type AgentContextPreview, type AgentContextQueueConfirmation} from "./contextSession";
import {decodeAgentSqlImmediateFailure, type AgentSqlImmediateDiagnostic} from "./sqlImmediateDiagnostic";
import {AgentSubmissionDecodeError, decodeAgentStartResponse, type AgentStartResponse} from "./submission";

export interface AgentContextStartRequest {
  readonly conversationId: string; readonly requestId: string; readonly contextSnapshotId: string;
  readonly queue: AgentContextQueueConfirmation | null; readonly resumeQueue: boolean;
}
export interface AgentContextStartStatusResponse {
  readonly schemaVersion: 1; readonly intent: AgentContextStartRequest; readonly expectedEpoch: string;
  readonly status: {readonly type: "started"; readonly result: AgentStartResponse}
    | {readonly type: "startedUnobserved"; readonly result: AgentStartResponse}
    | {readonly type: "startedSettled"; readonly result: AgentStartResponse}
    | {readonly type: "legacyStartedSettled"; readonly result: AgentStartResponse}
    | {readonly type: "legacyStartedObserved"; readonly result: AgentStartResponse}
    | {readonly type: "admitted"; readonly preview: AgentContextPreview}
    | {readonly type: "unconfirmed"; readonly detail: AgentSqlImmediateDiagnostic};
}
function fail(): never {throw new AgentSubmissionDecodeError();}
function fields(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const row = value as Record<string, unknown>;
  if (required.some(key => !Object.hasOwn(row, key)) || Object.keys(row).some(key => !required.includes(key) && !optional.includes(key))) return fail();
  return row;
}
function id(value: unknown): string {try {return catalogOperationId(value);} catch {return fail();}}
export function decodeAgentContextStartRequest(value: unknown): AgentContextStartRequest {
  const row = fields(value, ["conversationId", "requestId", "contextSnapshotId"], ["queue", "resumeQueue"]);
  if (row.resumeQueue !== undefined && typeof row.resumeQueue !== "boolean") return fail();
  return {conversationId: id(row.conversationId), requestId: id(row.requestId), contextSnapshotId: id(row.contextSnapshotId),
    queue: row.queue == null ? null : decodeAgentContextQueueConfirmation(row.queue), resumeQueue: row.resumeQueue === true};
}
export function sameAgentContextStartRequest(a: AgentContextStartRequest, b: AgentContextStartRequest): boolean {
  return JSON.stringify(decodeAgentContextStartRequest(a)) === JSON.stringify(decodeAgentContextStartRequest(b));
}
export function decodeAgentContextStartStatusResponse(value: unknown): AgentContextStartStatusResponse {
  const row = fields(value, ["schemaVersion", "intent", "expectedEpoch", "status"]);
  if (row.schemaVersion !== 1) return fail();
  const intent = decodeAgentContextStartRequest(row.intent), expectedEpoch = id(row.expectedEpoch);
  const status = fields(row.status, ["type"], ["detail", "result", "preview"]);
  if (status.type === "admitted") {
    fields(status, ["type", "preview"]); const preview = decodeAgentContextPreview(status.preview);
    if (!intent.queue || preview.conversationId !== intent.conversationId || preview.requestId !== intent.requestId
      || preview.contextSnapshotId !== intent.contextSnapshotId || JSON.stringify(preview.queue) !== JSON.stringify(intent.queue)) return fail();
    return {schemaVersion: 1, intent, expectedEpoch, status: {type: "admitted", preview}};
  }
  if (status.type === "started" || status.type === "startedUnobserved" || status.type === "startedSettled" || status.type === "legacyStartedSettled" || status.type === "legacyStartedObserved") {
    fields(status, ["type", "result"]);
    const result = decodeAgentStartResponse(status.result);
    if (!result.alreadyStarted || result.conversationId !== intent.conversationId || result.requestId !== intent.requestId) return fail();
    if ((status.type === "startedUnobserved" || status.type === "startedSettled" || status.type === "legacyStartedSettled") && result.runId) return fail();
    if ((status.type === "startedSettled" || status.type === "legacyStartedSettled") && result.outcome === null) return fail();
    if ((status.type === "legacyStartedSettled" || status.type === "legacyStartedObserved") && !intent.queue) return fail();
    if (status.type === "legacyStartedObserved" && !result.runId) return fail();
    return {schemaVersion: 1, intent, expectedEpoch, status: {type: status.type, result}};
  }
  if (status.type !== "unconfirmed") return fail();
  fields(status, ["type", "detail"]);
  const detail = fields(status.detail, ["operationId", "epoch", "sqlFence", "phase", "sqliteCode", "sqliteExtendedCode", "safeCause"]);
  const diagnostic = decodeAgentSqlImmediateFailure({code: "DATA_SQL_RECOVERY_REQUIRED", reason: detail})?.diagnostic;
  if (!diagnostic || id(diagnostic.operationId) !== intent.requestId || !diagnostic.phase || !diagnostic.safeCause
    || ["epoch", "sqlFence", "sqliteCode", "sqliteExtendedCode"].some(key => !Object.hasOwn(diagnostic, key))
    || diagnostic.epoch && id(diagnostic.epoch) !== expectedEpoch) return fail();
  return {schemaVersion: 1, intent, expectedEpoch, status: {type: "unconfirmed", detail: diagnostic}};
}
