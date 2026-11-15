import { AgentCatalogDecodeError, type AgentRenameRequest } from "./catalog";
import { catalogObject } from "./catalog-decoding";
import { catalogOperationId as uuid, agentSqlFence, catalogOperationBoolean as bool, catalogOperationReason } from "./catalogOperationDecoding";
export { agentSqlFence } from "./catalogOperationDecoding";

export const AGENT_RENAME_FAMILY = "agent.conversation.rename";

/** Historical transaction evidence. It never contains the current catalog view. */
export interface AgentRenameProof {
  readonly schemaVersion: 1;
  readonly operationId: string;
  readonly conversationId: string;
  readonly family: typeof AGENT_RENAME_FAMILY;
  readonly epoch: string;
  readonly sqlFence: string;
  readonly replayed: boolean;
  readonly result: null;
}
export type AgentRenameStatus =
  | { readonly type: "committed"; readonly proof: AgentRenameProof }
  | { readonly type: "noSqlReceipt"; readonly epoch: string; readonly sqlFence: string; readonly closed: boolean }
  | { readonly type: "unconfirmed"; readonly epoch: string; readonly sqlFence: string;
      readonly blocked: boolean; readonly closed: boolean; readonly reason: string };
export interface AgentRenameStatusResponse {
  readonly schemaVersion: 1;
  readonly operationId: string;
  readonly conversationId: string;
  readonly status: AgentRenameStatus;
}

function fail(): never { throw new AgentCatalogDecodeError(); }
/** Freeze the request's text; only UUID spelling is canonicalized. */
export function decodeAgentRenameRequest(value: unknown): AgentRenameRequest {
  const row = catalogObject(value, ["operationId", "id", "expectedTitle", "title"]);
  if (typeof row.expectedTitle !== "string"
    || typeof row.title !== "string" || !row.title.trim() || [...row.title.trim()].length > 180 || row.title.includes("\0")) return fail();
  return { operationId: uuid(row.operationId), id: uuid(row.id), expectedTitle: row.expectedTitle, title: row.title };
}
export function decodeAgentRenameProof(value: unknown): AgentRenameProof {
  const row = catalogObject(value, ["schemaVersion", "operationId", "conversationId", "family", "epoch", "sqlFence", "replayed", "result"]);
  if (row.schemaVersion !== 1 || row.family !== AGENT_RENAME_FAMILY || row.result !== null) return fail();
  return { schemaVersion: 1, operationId: uuid(row.operationId), conversationId: uuid(row.conversationId),
    family: AGENT_RENAME_FAMILY, epoch: uuid(row.epoch), sqlFence: agentSqlFence(row.sqlFence), replayed: bool(row.replayed), result: null };
}
export function decodeAgentRenameStatus(value: unknown): AgentRenameStatusResponse {
  const row = catalogObject(value, ["schemaVersion", "operationId", "conversationId", "status"]);
  if (row.schemaVersion !== 1) return fail();
  const operationId = uuid(row.operationId), conversationId = uuid(row.conversationId);
  const status = catalogObject(row.status, ["type", "proof", "epoch", "sqlFence", "blocked", "closed", "reason"]);
  let decoded: AgentRenameStatus;
  switch (status.type) {
    case "committed": {
      catalogObject(status, ["type", "proof"]);
      const proof = decodeAgentRenameProof(status.proof);
      if (proof.operationId !== operationId || proof.conversationId !== conversationId) return fail();
      decoded = { type: status.type, proof }; break;
    }
    case "noSqlReceipt":
      catalogObject(status, ["type", "epoch", "sqlFence", "closed"]);
      decoded = { type: status.type, epoch: uuid(status.epoch), sqlFence: agentSqlFence(status.sqlFence), closed: bool(status.closed) }; break;
    case "unconfirmed":
      catalogObject(status, ["type", "epoch", "sqlFence", "blocked", "closed", "reason"]);
      decoded = { type: status.type, epoch: uuid(status.epoch), sqlFence: agentSqlFence(status.sqlFence),
        blocked: bool(status.blocked), closed: bool(status.closed), reason: catalogOperationReason(status.reason) }; break;
    default: return fail();
  }
  return { schemaVersion: 1, operationId, conversationId, status: decoded };
}
