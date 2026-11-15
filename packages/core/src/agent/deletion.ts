import { AgentCatalogDecodeError, type AgentConversationBinding } from "./catalog";
import { catalogObject as object, catalogId as id, catalogBinding } from "./catalog-decoding";
import { catalogOperationId } from "./catalogOperationDecoding";

/** Transport precondition, excluded from the immutable deletion confirmation. */
export interface AgentDeletionWriteOptions { readonly expectedEpoch: string }
export function decodeAgentDeletionWriteOptions(value: unknown): AgentDeletionWriteOptions {
  const row = object(value, ["expectedEpoch"]);
  return { expectedEpoch: catalogOperationId(row.expectedEpoch) };
}

export interface AgentDeletionRequest {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly conversationId: string;
  /** null confirms deletion from the application-wide conversation catalog. */
  readonly binding: AgentConversationBinding | null;
  readonly expectedTitle: string;
  readonly expectedDurableCount: number;
  readonly force: boolean;
}
export interface AgentDeletionResponse {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly conversationId: string;
}
export const agentDeletionErrors = ["invalidInput", "notFound", "conflict", "busy", "tooLarge", "corrupt", "unavailable", "notArchived", "branchHistory", "proposalApplications", "executionWorkspace"] as const;
export type AgentDeletionError = typeof agentDeletionErrors[number];

export function decodeAgentDeletionRequest(value: unknown): AgentDeletionRequest {
  const row = object(value, ["schemaVersion", "requestId", "conversationId", "binding", "expectedTitle", "expectedDurableCount", "force"]);
  if (row.schemaVersion !== 1 || typeof row.expectedTitle !== "string" || !row.expectedTitle.trim()
    || [...row.expectedTitle].length > 180 || row.expectedTitle.includes("\0")
    || typeof row.expectedDurableCount !== "number" || !Number.isSafeInteger(row.expectedDurableCount) || row.expectedDurableCount < 0) throw new AgentCatalogDecodeError();
  if (row.force !== undefined && typeof row.force !== "boolean") throw new AgentCatalogDecodeError();
  return { schemaVersion: 1, requestId: id(row.requestId), conversationId: id(row.conversationId), binding: row.binding === null ? null : catalogBinding(row.binding), expectedTitle: row.expectedTitle, expectedDurableCount: row.expectedDurableCount, force: row.force === true };
}
export function decodeAgentDeletionResponse(value: unknown): AgentDeletionResponse {
  const row = object(value, ["schemaVersion", "requestId", "conversationId"]);
  if (row.schemaVersion !== 1) throw new AgentCatalogDecodeError();
  return { schemaVersion: 1, requestId: id(row.requestId), conversationId: id(row.conversationId) };
}
