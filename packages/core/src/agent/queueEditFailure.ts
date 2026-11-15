import { catalogOperationId } from "./catalogOperationDecoding";
import { decodeAgentQueueCommand } from "./submission";
import { decodeAgentQueueEditScope as scope, decodeAgentQueueEditRequestScope as originalScope, type AgentQueueEditScope } from "./queueEditIntent";
import { decodeAgentSqlImmediateFailure, type AgentSqlImmediateFailure } from "./sqlImmediateDiagnostic";

export type AgentQueueStorageScope = AgentQueueEditScope;
export interface AgentQueueStorageFailure {
  readonly code: "QUEUE_STORAGE_FAILURE";
  readonly conversationId: string;
  readonly requestId: string;
  readonly operationId: string;
  readonly scope: AgentQueueStorageScope;
  readonly reason: AgentSqlImmediateFailure;
}
function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
/** Recognize only storage diagnostics for the complete original queue command.
 * Unknown fields are never copied, and a foreign/invalid inner operation ID
 * cannot be upgraded into matched details by the shared safe-field decoder. */
export function decodeAgentQueueStorageFailure(value: unknown, request: unknown): AgentQueueStorageFailure | undefined {
  const row = object(value), original = object(request);
  if (!row || row.code !== "QUEUE_STORAGE_FAILURE" || !original) return undefined;
  try {
    const conversationId = catalogOperationId(original.conversationId);
    const command = decodeAgentQueueCommand({requestId: original.requestId, expectedRevision: original.expectedRevision, edit: original.edit});
    const requestId = command.requestId, expected = originalScope(original, conversationId);
    const operationId = catalogOperationId(row.operationId), responseScope = scope(row.scope, conversationId);
    if (catalogOperationId(row.conversationId) !== conversationId || catalogOperationId(row.requestId) !== requestId
      || operationId !== requestId || JSON.stringify(responseScope) !== JSON.stringify(expected)) return undefined;
    const reason = decodeAgentSqlImmediateFailure(row.reason);
    if (!reason) return undefined;
    const rawReason = object(row.reason), rawCode = rawReason?.code === "storage" ? object(rawReason.reason) : rawReason;
    const rawDetail = object(rawCode?.reason);
    if (rawDetail && Object.hasOwn(rawDetail, "operationId") && catalogOperationId(rawDetail.operationId) !== operationId) return undefined;
    return {code: "QUEUE_STORAGE_FAILURE", conversationId, requestId, operationId, scope: responseScope, reason};
  } catch {
    // An unverified diagnostic supplies no facts about this command's outcome.
    return undefined;
  }
}
