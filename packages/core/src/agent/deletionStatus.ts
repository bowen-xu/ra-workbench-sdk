import { AgentCatalogDecodeError } from "./catalog";
import { catalogObject } from "./catalog-decoding";
import { catalogOperationId as uuid, agentSqlFence, catalogOperationBoolean as bool, catalogOperationReason } from "./catalogOperationDecoding";

export const AGENT_DELETION_FAMILY = "agent.conversation.delete";
/** SQL publication evidence; absence says nothing about external file cleanup. */
export interface AgentDeletionProof {
  readonly schemaVersion: 1; readonly operationId: string; readonly conversationId: string;
  readonly family: typeof AGENT_DELETION_FAMILY; readonly epoch: string; readonly sqlFence: string;
  readonly replayed: boolean; readonly result: null;
}
export type AgentDeletionStatus =
  | { readonly type: "committed"; readonly proof: AgentDeletionProof }
  | { readonly type: "noSqlReceipt"; readonly epoch: string; readonly sqlFence: string; readonly closed: boolean }
  | { readonly type: "unconfirmed"; readonly epoch: string; readonly sqlFence: string;
      readonly blocked: boolean; readonly closed: boolean; readonly reason: string };
export interface AgentDeletionStatusResponse {
  readonly schemaVersion: 1; readonly operationId: string; readonly conversationId: string; readonly status: AgentDeletionStatus;
}
function fail(): never { throw new AgentCatalogDecodeError(); }
export function decodeAgentDeletionProof(value: unknown): AgentDeletionProof {
  const row = catalogObject(value, ["schemaVersion", "operationId", "conversationId", "family", "epoch", "sqlFence", "replayed", "result"]);
  if (row.schemaVersion !== 1 || row.family !== AGENT_DELETION_FAMILY || row.result !== null) return fail();
  return { schemaVersion: 1, operationId: uuid(row.operationId), conversationId: uuid(row.conversationId), family: AGENT_DELETION_FAMILY,
    epoch: uuid(row.epoch), sqlFence: agentSqlFence(row.sqlFence), replayed: bool(row.replayed), result: null };
}
export function decodeAgentDeletionStatus(value: unknown): AgentDeletionStatusResponse {
  const row = catalogObject(value, ["schemaVersion", "operationId", "conversationId", "status"]);
  if (row.schemaVersion !== 1) return fail();
  const operationId = uuid(row.operationId), conversationId = uuid(row.conversationId);
  const status = catalogObject(row.status, ["type", "proof", "epoch", "sqlFence", "blocked", "closed", "reason"]);
  let decoded: AgentDeletionStatus;
  switch (status.type) {
    case "committed": {
      catalogObject(status, ["type", "proof"]);
      const proof = decodeAgentDeletionProof(status.proof);
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
