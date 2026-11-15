import { AgentCatalogDecodeError } from "./catalog";
import { catalogId, catalogObject } from "./catalog-decoding";
import { decodeAgentDeletionRequest, type AgentDeletionRequest } from "./deletion";

export type AgentDeletionBatchResult =
  | { readonly requestId: string; readonly conversationId: string; readonly status: "deleted"; readonly cleanupPending: boolean }
  | { readonly requestId: string; readonly conversationId: string; readonly status: "failed"; readonly error: unknown };

export interface AgentDeletionBatchResponse {
  readonly schemaVersion: 1;
  readonly results: readonly AgentDeletionBatchResult[];
}

export function decodeAgentDeletionBatchRequests(value: unknown): readonly AgentDeletionRequest[] {
  if (!Array.isArray(value) || value.length === 0) throw new AgentCatalogDecodeError();
  const requests = value.map(decodeAgentDeletionRequest);
  if (new Set(requests.map(request => request.requestId)).size !== requests.length
    || new Set(requests.map(request => request.conversationId)).size !== requests.length) throw new AgentCatalogDecodeError();
  return requests;
}

export function decodeAgentDeletionBatchResponse(value: unknown): AgentDeletionBatchResponse {
  const row = catalogObject(value, ["schemaVersion", "results"]);
  if (row.schemaVersion !== 1 || !Array.isArray(row.results)) throw new AgentCatalogDecodeError();
  const results: AgentDeletionBatchResult[] = row.results.map(value => {
    const result = catalogObject(value, ["requestId", "conversationId", "status", "error", "cleanupPending"]);
    const requestId = catalogId(result.requestId), conversationId = catalogId(result.conversationId);
    if (result.status === "deleted" && result.error === undefined && typeof result.cleanupPending === "boolean") return {requestId, conversationId, status: "deleted", cleanupPending: result.cleanupPending};
    if (result.status === "failed" && result.cleanupPending === undefined && result.error !== undefined && result.error !== null) return {requestId, conversationId, status: "failed", error: result.error};
    throw new AgentCatalogDecodeError();
  });
  return {schemaVersion: 1, results};
}
