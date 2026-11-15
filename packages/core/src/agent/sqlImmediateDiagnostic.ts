/** Safe classifications shared by SQL-backed commands; no provider body enters this DTO. */
export type AgentSqlImmediateCode = "DATA_SQL_INVALID" | "DATA_SQL_UNMANAGED" | "DATA_SQL_OPERATION_CONFLICT"
  | "DATA_SQL_COMMIT_UNKNOWN" | "DATA_OPERATION_PARTIAL" | "DATA_OPERATION_OUTCOME_UNKNOWN" | "DATA_SQL_RECOVERY_REQUIRED" | "DATA_SQL_UNAVAILABLE" | "DATA_SQL_CORRUPT";
export interface AgentSqlImmediateDiagnostic {
  readonly operationId?: string;
  readonly epoch?: string | null;
  readonly sqlFence?: string | null;
  readonly phase?: string;
  readonly sqliteCode?: string | null;
  readonly sqliteExtendedCode?: number | null;
  readonly safeCause?: string;
}
export interface AgentSqlImmediateFailure {
  readonly code: AgentSqlImmediateCode;
  readonly diagnostic?: AgentSqlImmediateDiagnostic;
}
const codes: readonly string[] = ["DATA_SQL_INVALID", "DATA_SQL_UNMANAGED", "DATA_SQL_OPERATION_CONFLICT",
  "DATA_SQL_COMMIT_UNKNOWN", "DATA_OPERATION_PARTIAL", "DATA_OPERATION_OUTCOME_UNKNOWN", "DATA_SQL_RECOVERY_REQUIRED", "DATA_SQL_UNAVAILABLE", "DATA_SQL_CORRUPT"];
function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function uuid(value: unknown): value is string {
  return typeof value === "string" && /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/iu.test(value);
}
function token(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z][a-zA-Z0-9_-]{0,100}$/u.test(value);
}
function fence(value: unknown): value is string {
  return typeof value === "string" && /^(?:0|[1-9][0-9]{0,19})$/u.test(value)
    && (value.length < 20 || value <= "18446744073709551615");
}

/** Recognize the deployed direct/wrapped failure, copying only safe known fields. */
export function decodeAgentSqlImmediateFailure(value: unknown): AgentSqlImmediateFailure | undefined {
  const outer = object(value), row = outer?.code === "storage" ? object(outer.reason) : outer;
  if (!row || typeof row.code !== "string" || !codes.includes(row.code)) return undefined;
  const code = row.code as AgentSqlImmediateCode, detail = object(row.reason);
  if (!detail) return { code };
  const diagnostic: AgentSqlImmediateDiagnostic = {
    ...(uuid(detail.operationId) ? { operationId: detail.operationId } : {}),
    ...(detail.epoch === null || uuid(detail.epoch) ? { epoch: detail.epoch } : {}),
    ...(detail.sqlFence === null || fence(detail.sqlFence) ? { sqlFence: detail.sqlFence } : {}),
    ...(token(detail.phase) ? { phase: detail.phase } : {}),
    ...(detail.sqliteCode === null || token(detail.sqliteCode) ? { sqliteCode: detail.sqliteCode } : {}),
    ...(detail.sqliteExtendedCode === null || (typeof detail.sqliteExtendedCode === "number"
      && Number.isInteger(detail.sqliteExtendedCode) && detail.sqliteExtendedCode >= 0 && detail.sqliteExtendedCode <= 2_147_483_647)
      ? { sqliteExtendedCode: detail.sqliteExtendedCode } : {}),
    ...(token(detail.safeCause) ? { safeCause: detail.safeCause } : {}),
  };
  return { code, diagnostic };
}
export function isAgentSqlImmediateUnknown(value: unknown): boolean {
  const code = decodeAgentSqlImmediateFailure(value)?.code;
  return code === "DATA_SQL_COMMIT_UNKNOWN" || code === "DATA_OPERATION_OUTCOME_UNKNOWN" || code === "DATA_SQL_RECOVERY_REQUIRED";
}
