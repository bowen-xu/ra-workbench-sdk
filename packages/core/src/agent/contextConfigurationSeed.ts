import { AgentCatalogDecodeError } from "./catalog";
import { catalogObject } from "./catalog-decoding";
import { agentSqlFence, catalogOperationBoolean, catalogOperationId, catalogOperationReason } from "./catalogOperationDecoding";

export const AGENT_CONTEXT_CONFIGURATION_SEED_FAMILY = "agent.context.configuration.seed";
export interface AgentContextConfigurationSeedIntent {
  readonly operationId: string; readonly conversationId: string; readonly expectedEpoch: string;
}
export interface AgentContextConfigurationSeedProof {
  readonly schemaVersion: 1; readonly operationId: string; readonly conversationId: string;
  readonly family: typeof AGENT_CONTEXT_CONFIGURATION_SEED_FAMILY; readonly epoch: string;
  readonly sqlFence: string; readonly replayed: boolean; readonly result: null;
}
export type AgentContextConfigurationSeedStatus =
  | { readonly type: "committed"; readonly proof: AgentContextConfigurationSeedProof }
  | { readonly type: "noSqlReceipt"; readonly epoch: string; readonly sqlFence: string; readonly closed: boolean }
  | { readonly type: "unconfirmed"; readonly epoch: string; readonly sqlFence: string; readonly blocked: boolean; readonly closed: boolean; readonly reason: string };

function fail(): never { throw new AgentCatalogDecodeError(); }
export function decodeAgentContextConfigurationSeedIntent(value: unknown): AgentContextConfigurationSeedIntent {
  const row = catalogObject(value, ["operationId", "conversationId", "expectedEpoch"]);
  return { operationId: catalogOperationId(row.operationId), conversationId: catalogOperationId(row.conversationId), expectedEpoch: catalogOperationId(row.expectedEpoch) };
}
export function decodeAgentContextConfigurationSeedProof(value: unknown): AgentContextConfigurationSeedProof {
  const row = catalogObject(value, ["schemaVersion", "operationId", "conversationId", "family", "epoch", "sqlFence", "replayed", "result"]);
  if (row.schemaVersion !== 1 || row.family !== AGENT_CONTEXT_CONFIGURATION_SEED_FAMILY || row.result !== null) return fail();
  return { schemaVersion: 1, operationId: catalogOperationId(row.operationId), conversationId: catalogOperationId(row.conversationId),
    family: AGENT_CONTEXT_CONFIGURATION_SEED_FAMILY, epoch: catalogOperationId(row.epoch), sqlFence: agentSqlFence(row.sqlFence),
    replayed: catalogOperationBoolean(row.replayed), result: null };
}
export function decodeAgentContextConfigurationSeedStatus(value: unknown): AgentContextConfigurationSeedStatus {
  const row = catalogObject(value, ["type", "proof", "epoch", "sqlFence", "closed", "blocked", "reason"]);
  switch (row.type) {
    case "committed": catalogObject(row, ["type", "proof"]); return { type: row.type, proof: decodeAgentContextConfigurationSeedProof(row.proof) };
    case "noSqlReceipt": catalogObject(row, ["type", "epoch", "sqlFence", "closed"]); return { type: row.type, epoch: catalogOperationId(row.epoch), sqlFence: agentSqlFence(row.sqlFence), closed: catalogOperationBoolean(row.closed) };
    case "unconfirmed": catalogObject(row, ["type", "epoch", "sqlFence", "closed", "blocked", "reason"]); return { type: row.type, epoch: catalogOperationId(row.epoch), sqlFence: agentSqlFence(row.sqlFence), closed: catalogOperationBoolean(row.closed), blocked: catalogOperationBoolean(row.blocked), reason: catalogOperationReason(row.reason) };
    default: return fail();
  }
}
