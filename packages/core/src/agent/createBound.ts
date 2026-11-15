import { AgentCatalogDecodeError, type AgentConversationBinding } from "./catalog";
import { catalogBinding, catalogObject } from "./catalog-decoding";
import { catalogOperationId as id, agentSqlFence, catalogOperationBoolean as bool, catalogOperationReason } from "./catalogOperationDecoding";

export const AGENT_CREATE_BOUND_FAMILY = "agent.conversation.create_bound";
/** A metadata operation distinct from initial binding-only and model request IDs. */
export interface AgentCreateBoundRequest {
  readonly operationId: string;
  readonly id: string;
  readonly binding: AgentConversationBinding;
}
/** Historical creation evidence; never a current Summary or runtime admission. */
export interface AgentCreateBoundProof {
  readonly schemaVersion: 1;
  readonly operationId: string;
  readonly conversationId: string;
  readonly family: typeof AGENT_CREATE_BOUND_FAMILY;
  readonly epoch: string;
  readonly sqlFence: string;
  readonly replayed: boolean;
  readonly result: null;
}
export type AgentCreateBoundStatus =
  | { readonly type: "committed"; readonly proof: AgentCreateBoundProof }
  | { readonly type: "noSqlReceipt"; readonly epoch: string; readonly sqlFence: string; readonly closed: boolean }
  | { readonly type: "unconfirmed"; readonly epoch: string; readonly sqlFence: string;
      readonly blocked: boolean; readonly closed: boolean; readonly reason: string };
export interface AgentCreateBoundStatusResponse {
  readonly schemaVersion: 1;
  readonly operationId: string;
  readonly conversationId: string;
  readonly status: AgentCreateBoundStatus;
}
function fail(): never { throw new AgentCatalogDecodeError(); }
export function decodeAgentCreateBoundRequest(value: unknown): AgentCreateBoundRequest {
  const row = catalogObject(value, ["operationId", "id", "binding"]);
  return { operationId: id(row.operationId), id: id(row.id), binding: catalogBinding(row.binding) };
}
export function decodeAgentCreateBoundProof(value: unknown): AgentCreateBoundProof {
  const row = catalogObject(value, ["schemaVersion", "operationId", "conversationId", "family", "epoch", "sqlFence", "replayed", "result"]);
  if (row.schemaVersion !== 1 || row.family !== AGENT_CREATE_BOUND_FAMILY || row.result !== null) return fail();
  return { schemaVersion: 1, operationId: id(row.operationId), conversationId: id(row.conversationId),
    family: AGENT_CREATE_BOUND_FAMILY, epoch: id(row.epoch), sqlFence: agentSqlFence(row.sqlFence), replayed: bool(row.replayed), result: null };
}
export function decodeAgentCreateBoundStatus(value: unknown): AgentCreateBoundStatusResponse {
  const row = catalogObject(value, ["schemaVersion", "operationId", "conversationId", "status"]);
  if (row.schemaVersion !== 1) return fail();
  const operationId = id(row.operationId), conversationId = id(row.conversationId);
  const status = catalogObject(row.status, ["type", "proof", "epoch", "sqlFence", "blocked", "closed", "reason"]);
  let decoded: AgentCreateBoundStatus;
  switch (status.type) {
    case "committed": {
      catalogObject(status, ["type", "proof"]);
      const proof = decodeAgentCreateBoundProof(status.proof);
      if (proof.operationId !== operationId || proof.conversationId !== conversationId) return fail();
      decoded = {type: status.type, proof}; break;
    }
    case "noSqlReceipt":
      catalogObject(status, ["type", "epoch", "sqlFence", "closed"]);
      decoded = {type: status.type, epoch: id(status.epoch), sqlFence: agentSqlFence(status.sqlFence), closed: bool(status.closed)}; break;
    case "unconfirmed":
      catalogObject(status, ["type", "epoch", "sqlFence", "blocked", "closed", "reason"]);
      decoded = {type: status.type, epoch: id(status.epoch), sqlFence: agentSqlFence(status.sqlFence),
        blocked: bool(status.blocked), closed: bool(status.closed), reason: catalogOperationReason(status.reason)}; break;
    default: return fail();
  }
  return {schemaVersion: 1, operationId, conversationId, status: decoded};
}
