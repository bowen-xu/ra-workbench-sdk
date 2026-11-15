import type { AgentWorkspaceScope } from "./workspace";
import { AgentWorkspaceDecodeError, row, id } from "./workspaceDecoding";

export interface AgentWritingFileDeliveryAdmission {
  readonly scope: AgentWorkspaceScope;
  readonly turnId: string;
}
export interface AgentWritingFileDeliveryEntry extends AgentWritingFileDeliveryAdmission { readonly id: number }
export interface AgentWritingFileDeliveryRequest {
  readonly manuscriptId: string;
  readonly after: number | null;
  readonly limit: number;
}
export interface AgentWritingFileDeliveryPage {
  readonly schemaVersion: 1;
  readonly manuscriptId: string;
  readonly items: readonly AgentWritingFileDeliveryEntry[];
  readonly nextCursor: number | null;
}
function ordinal(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new AgentWorkspaceDecodeError();
  return value;
}
export function decodeAgentWritingFileDeliveryAdmission(value: unknown): AgentWritingFileDeliveryAdmission {
  const data = row(value, ["scope", "turnId"]);
  const scope = row(data.scope, ["manuscriptId", "conversationId", "requestId", "contextSnapshotId"]);
  return { turnId: id(data.turnId), scope: { manuscriptId: id(scope.manuscriptId), conversationId: id(scope.conversationId),
    requestId: id(scope.requestId), contextSnapshotId: id(scope.contextSnapshotId) } };
}
export function decodeAgentWritingFileDeliveryRequest(value: unknown): AgentWritingFileDeliveryRequest {
  const data = row(value, ["manuscriptId", "after", "limit"]);
  if (typeof data.limit !== "number" || !Number.isInteger(data.limit) || data.limit < 1 || data.limit > 64) throw new AgentWorkspaceDecodeError();
  return { manuscriptId: id(data.manuscriptId), after: data.after === null ? null : ordinal(data.after), limit: data.limit };
}
export function decodeAgentWritingFileDeliveryPage(value: unknown): AgentWritingFileDeliveryPage {
  const data = row(value, ["schemaVersion", "manuscriptId", "items", "nextCursor"]);
  if (data.schemaVersion !== 1 || !Array.isArray(data.items) || data.items.length > 64) throw new AgentWorkspaceDecodeError();
  const manuscriptId = id(data.manuscriptId);
  const items = data.items.map((item): AgentWritingFileDeliveryEntry => {
    const entry = row(item, ["id", "scope", "turnId"]);
    const admission = decodeAgentWritingFileDeliveryAdmission({ scope: entry.scope, turnId: entry.turnId });
    if (admission.scope.manuscriptId !== manuscriptId) throw new AgentWorkspaceDecodeError();
    return { ...admission, id: ordinal(entry.id) };
  });
  if (items.some((item, index) => index > 0 && item.id <= items[index - 1]!.id)
    || new Set(items.map((item) => item.turnId)).size !== items.length
    || new Set(items.map((item) => JSON.stringify(item.scope))).size !== items.length) throw new AgentWorkspaceDecodeError();
  const nextCursor = data.nextCursor === null ? null : ordinal(data.nextCursor);
  if (nextCursor !== null && nextCursor !== items.at(-1)?.id) throw new AgentWorkspaceDecodeError();
  return { schemaVersion: 1, manuscriptId, items, nextCursor };
}
