/** Process-local task observation; unavailable never proves what happened. */
export interface AgentTaskObservationRequest {
  readonly conversationId: string;
  readonly turnId: string;
  readonly runId: string;
}
export interface AgentTaskDiagnostic {
  readonly code: string;
  readonly phase: string;
  readonly safeCause: string;
  readonly [key: string]: string | number | null;
}
export type AgentTaskStatus = {readonly type: "pending" | "unavailable" | "settled"} | {
  readonly type: "finished";
  readonly completion: "completed" | "canceled" | "failed" | "recoveryRequired";
  readonly diagnostic: AgentTaskDiagnostic | null;
};
export interface AgentTaskObservationResponse extends AgentTaskObservationRequest {
  readonly schemaVersion: 1;
  readonly status: AgentTaskStatus;
}
export class AgentTaskObservationDecodeError extends Error {
  constructor() { super("Invalid agent task observation"); this.name = "AgentTaskObservationDecodeError"; }
}
const fail = (): never => { throw new AgentTaskObservationDecodeError(); };
function row(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const object = value as Record<string, unknown>;
  if (Object.keys(object).length !== keys.length || keys.some(key => !Object.hasOwn(object, key))) return fail();
  return object;
}
function uuid(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu.test(value)
    || value.toLowerCase() === "00000000-0000-0000-0000-000000000000") return fail();
  return value.toLowerCase();
}
function token(value: unknown): string {
  return typeof value === "string" && /^[a-zA-Z][a-zA-Z0-9_-]{0,100}$/u.test(value) ? value : fail();
}
const uuidKeys = ["conversationId", "requestId", "turnId", "operationId", "contextSnapshotId", "childConversationId", "childTurnId",
  "childContextSnapshotId", "childArchiveOperationId", "manuscriptId", "leaseId", "resultId"] as const;
const opaqueKeys = ["callId", "callRequestId", "targetRequestId", "journalRequestId"] as const;
function diagnostic(value: unknown): AgentTaskDiagnostic {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const source = value as Record<string, unknown>, keys = Object.keys(source);
  const allowed = ["code", "phase", "safeCause", ...uuidKeys, ...opaqueKeys,
    "childArchiveIntentVersion", "childArchiveExpectedWatermark", "sqliteCode", "sqliteExtendedCode"];
  if (keys.length > 16 || keys.some(key => !allowed.includes(key))) return fail();
  const result: Record<string, string | number | null> = {code: token(source.code), phase: token(source.phase), safeCause: token(source.safeCause)};
  for (const key of uuidKeys) if (Object.hasOwn(source, key)) result[key] = source[key] === null ? null : uuid(source[key]);
  for (const key of opaqueKeys) if (Object.hasOwn(source, key)) {
    const value = source[key];
    if (value !== null && (typeof value !== "string" || !/^[a-zA-Z0-9_.:/-]{1,1024}$/u.test(value))) return fail();
    result[key] = value as string | null;
  }
  if (Object.hasOwn(source, "sqliteCode")) result.sqliteCode = source.sqliteCode === null ? null : token(source.sqliteCode);
  if (Object.hasOwn(source, "sqliteExtendedCode")) {
    const value = source.sqliteExtendedCode;
    if (value !== null && (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 2147483647)) return fail();
    result.sqliteExtendedCode = value as number | null;
  }
  if ((Object.hasOwn(source, "childArchiveIntentVersion") && source.childArchiveIntentVersion === undefined)
    || (Object.hasOwn(source, "childArchiveExpectedWatermark") && source.childArchiveExpectedWatermark === undefined)) return fail();
  const version = source.childArchiveIntentVersion ?? null, watermark = source.childArchiveExpectedWatermark ?? null;
  const archive = source.childArchiveOperationId ?? null;
  if (version !== null || watermark !== null || archive !== null) {
    if (version !== 1 || !Number.isSafeInteger(watermark) || (watermark as number) < 0 || archive === null
      || !result.requestId || !result.resultId) return fail();
  }
  if (Object.hasOwn(source, "childArchiveIntentVersion")) result.childArchiveIntentVersion = version as number | null;
  if (Object.hasOwn(source, "childArchiveExpectedWatermark")) result.childArchiveExpectedWatermark = watermark as number | null;
  // Every accepted key and string value is ASCII, so character and UTF-8 byte
  // counts agree after validation; never serialize untrusted objects first.
  if (JSON.stringify(result).length > 8192) return fail();
  return result as AgentTaskDiagnostic;
}
export function decodeAgentTaskObservationRequest(value: unknown): AgentTaskObservationRequest {
  const object = row(value, ["conversationId", "turnId", "runId"]);
  return {conversationId: uuid(object.conversationId), turnId: uuid(object.turnId), runId: uuid(object.runId)};
}
export function decodeAgentTaskObservationResponse(value: unknown): AgentTaskObservationResponse {
  const object = row(value, ["schemaVersion", "conversationId", "turnId", "runId", "status"]);
  if (object.schemaVersion !== 1 || !object.status || typeof object.status !== "object" || Array.isArray(object.status)) return fail();
  const source = object.status as Record<string, unknown>;
  let status: AgentTaskStatus;
  if (source.type === "pending" || source.type === "unavailable" || source.type === "settled") {
    row(source, ["type"]); status = {type: source.type};
  } else {
    row(source, ["type", "completion", "diagnostic"]);
    if (source.type !== "finished" || (source.completion !== "completed" && source.completion !== "canceled"
      && source.completion !== "failed" && source.completion !== "recoveryRequired")) return fail();
    status = {type: "finished", completion: source.completion, diagnostic: source.diagnostic === null ? null : diagnostic(source.diagnostic)};
  }
  return {schemaVersion: 1, ...decodeAgentTaskObservationRequest({conversationId: object.conversationId, turnId: object.turnId, runId: object.runId}), status};
}
