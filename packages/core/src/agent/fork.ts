import { AgentCatalogDecodeError, decodeAgentRenameResponse, type AgentConversationBinding, type AgentConversationSummary } from "./catalog";
import { catalogObject as object, catalogId as id, catalogBinding as decodeBinding } from "./catalog-decoding";
import { catalogOperationId } from "./catalogOperationDecoding";

export interface AgentForkRequest {
  readonly childId: string; readonly parentId: string; readonly throughTurnId: string; readonly binding: AgentConversationBinding;
}
/** Write precondition only, separate from the immutable fork operation identity. */
export interface AgentForkWriteOptions { readonly expectedEpoch: string }
export function decodeAgentForkWriteOptions(value: unknown): AgentForkWriteOptions {
  const row = object(value, ["expectedEpoch"]);
  return { expectedEpoch: catalogOperationId(row.expectedEpoch) };
}
export interface AgentForkResponse {
  readonly schemaVersion: 1; readonly conversation: AgentConversationSummary;
  readonly parentId: string; readonly throughTurnId: string; readonly parentEndSeq: number;
}
export interface AgentForkOriginRequest { readonly conversationId: string; readonly binding: AgentConversationBinding }
export interface AgentForkOrigin { readonly parent: AgentConversationSummary; readonly throughTurnId: string; readonly parentEndSeq: number }
export interface AgentForkOriginResponse { readonly schemaVersion: 1; readonly conversationId: string; readonly origin: AgentForkOrigin | null }
export function decodeAgentForkRequest(value: unknown): AgentForkRequest {
  const row = object(value, ["childId", "parentId", "throughTurnId", "binding"]);
  const childId = id(row.childId), parentId = id(row.parentId), throughTurnId = id(row.throughTurnId);
  if (childId === parentId) throw new AgentCatalogDecodeError();
  return { childId, parentId, throughTurnId, binding: decodeBinding(row.binding) };
}
export function decodeAgentForkOriginRequest(value: unknown): AgentForkOriginRequest {
  const row = object(value, ["conversationId", "binding"]);
  return { conversationId: id(row.conversationId), binding: decodeBinding(row.binding) };
}
export function decodeAgentForkOriginResponse(value: unknown): AgentForkOriginResponse {
  const row = object(value, ["schemaVersion", "conversationId", "origin"]);
  if (row.schemaVersion !== 1) throw new AgentCatalogDecodeError();
  const conversationId = id(row.conversationId);
  if (row.origin === null) return { schemaVersion: 1, conversationId, origin: null };
  const origin = object(row.origin, ["parent", "throughTurnId", "parentEndSeq"]);
  const { conversation: parent } = decodeAgentRenameResponse({ schemaVersion: 1, conversation: origin.parent });
  const throughTurnId = id(origin.throughTurnId);
  if (id(parent.id) === conversationId || typeof origin.parentEndSeq !== "number" || !Number.isSafeInteger(origin.parentEndSeq)
    || origin.parentEndSeq <= 0 || origin.parentEndSeq > parent.durableCount) throw new AgentCatalogDecodeError();
  return { schemaVersion: 1, conversationId, origin: { parent, throughTurnId, parentEndSeq: origin.parentEndSeq } };
}
export function decodeAgentForkResponse(value: unknown): AgentForkResponse {
  const row = object(value, ["schemaVersion", "conversation", "parentId", "throughTurnId", "parentEndSeq"]);
  const { conversation } = decodeAgentRenameResponse({ schemaVersion: row.schemaVersion, conversation: row.conversation });
  const parentId = id(row.parentId), throughTurnId = id(row.throughTurnId);
  if (id(conversation.id) === parentId || typeof row.parentEndSeq !== "number" || !Number.isSafeInteger(row.parentEndSeq)
    || row.parentEndSeq <= 0 || row.parentEndSeq > conversation.durableCount) throw new AgentCatalogDecodeError();
  return { schemaVersion: 1, conversation, parentId, throughTurnId, parentEndSeq: row.parentEndSeq };
}
