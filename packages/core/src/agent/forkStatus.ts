import { AgentCatalogDecodeError } from "./catalog";
import { catalogObject } from "./catalog-decoding";
import { catalogOperationId as uuid, agentSqlFence, catalogOperationBoolean as bool, catalogOperationReason } from "./catalogOperationDecoding";

export const AGENT_FORK_FAMILY = "agent.conversation.fork";
/** Original publication evidence, never the child's current metadata. */
export interface AgentForkProof {
  readonly schemaVersion: 1; readonly operationId: string; readonly conversationId: string;
  readonly family: typeof AGENT_FORK_FAMILY; readonly epoch: string; readonly sqlFence: string;
  readonly replayed: boolean; readonly result: null;
}
export type AgentForkStatus =
  | { readonly type: "committed"; readonly proof: AgentForkProof }
  | { readonly type: "noSqlReceipt"; readonly epoch: string; readonly sqlFence: string; readonly closed: boolean }
  | { readonly type: "unconfirmed"; readonly epoch: string; readonly sqlFence: string;
      readonly blocked: boolean; readonly closed: boolean; readonly reason: string };
export interface AgentForkStatusResponse {
  readonly schemaVersion: 1; readonly operationId: string; readonly conversationId: string; readonly status: AgentForkStatus;
}
function fail(): never { throw new AgentCatalogDecodeError(); }
export function decodeAgentForkProof(value: unknown): AgentForkProof {
  const row = catalogObject(value, ["schemaVersion", "operationId", "conversationId", "family", "epoch", "sqlFence", "replayed", "result"]);
  if (row.schemaVersion !== 1 || row.family !== AGENT_FORK_FAMILY || row.result !== null) return fail();
  const operationId = uuid(row.operationId), conversationId = uuid(row.conversationId);
  if (operationId !== conversationId) return fail();
  return { schemaVersion: 1, operationId, conversationId, family: AGENT_FORK_FAMILY,
    epoch: uuid(row.epoch), sqlFence: agentSqlFence(row.sqlFence), replayed: bool(row.replayed), result: null };
}
export function decodeAgentForkStatus(value: unknown): AgentForkStatusResponse {
  const row = catalogObject(value, ["schemaVersion", "operationId", "conversationId", "status"]);
  if (row.schemaVersion !== 1) return fail();
  const operationId = uuid(row.operationId), conversationId = uuid(row.conversationId);
  if (operationId !== conversationId) return fail();
  const status = catalogObject(row.status, ["type", "proof", "epoch", "sqlFence", "blocked", "closed", "reason"]);
  let decoded: AgentForkStatus;
  switch (status.type) {
    case "committed": {
      catalogObject(status, ["type", "proof"]);
      const proof = decodeAgentForkProof(status.proof);
      if (proof.operationId !== operationId) return fail();
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
