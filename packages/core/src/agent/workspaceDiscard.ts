import type { AgentWorkspaceConfirmation, AgentWorkspaceScope } from "./workspace";
import { AgentWorkspaceDecodeError, id, row, utf8Length } from "./workspaceDecoding";
import { decodeAgentWorkspaceConfirmation, decodeAgentWorkspaceReview, type AgentWorkspaceReview } from "./workspaceReview";

export interface AgentWorkspaceDiscardConfirmation {
  readonly operationId: string;
  readonly binding: AgentWorkspaceConfirmation;
  readonly environmentId: string;
  readonly inventoryHash: string;
}
export interface AgentWorkspaceDiscardRecovery extends AgentWorkspaceDiscardConfirmation {
  readonly schemaVersion: 1;
  readonly state: "pending" | "complete";
}
export interface AgentWorkspaceDiscardPreview {
  readonly schemaVersion: 1;
  readonly confirmation: AgentWorkspaceDiscardConfirmation;
  readonly review: AgentWorkspaceReview;
}

export function decodeAgentWorkspaceDiscardRecovery(
  value: unknown, expected: AgentWorkspaceScope,
): AgentWorkspaceDiscardRecovery | null {
  const scope = {
    conversationId: id(expected.conversationId), requestId: id(expected.requestId),
    manuscriptId: id(expected.manuscriptId), contextSnapshotId: id(expected.contextSnapshotId),
  };
  if (value === null) return null;
  const record = row(value, ["schemaVersion", "operationId", "binding", "environmentId", "inventoryHash", "state"]);
  const binding = decodeAgentWorkspaceConfirmation(record.binding);
  for (const key of ["conversationId", "requestId", "manuscriptId", "contextSnapshotId"] as const) {
    if (binding.scope[key] !== scope[key]) throw new AgentWorkspaceDecodeError();
  }
  if (record.schemaVersion !== 1 || (record.state !== "pending" && record.state !== "complete")
    || typeof record.environmentId !== "string" || !record.environmentId.trim()
    || utf8Length(record.environmentId) > 1024 || /[\u0000-\u001f\u007f-\u009f]/.test(record.environmentId)
    || typeof record.inventoryHash !== "string" || !/^[0-9a-f]{64}$/.test(record.inventoryHash)) {
    throw new AgentWorkspaceDecodeError();
  }
  return { schemaVersion: 1, operationId: id(record.operationId), binding, environmentId: record.environmentId,
    inventoryHash: record.inventoryHash, state: record.state };
}

/** Ready confirmations share recovery identity validation, but are not intents. */
export function decodeAgentWorkspaceDiscardPreview(value: unknown, scope: AgentWorkspaceScope): AgentWorkspaceDiscardPreview {
  const record = row(value, ["schemaVersion", "confirmation", "review"]);
  if (record.schemaVersion !== 1) throw new AgentWorkspaceDecodeError();
  const input = row(record.confirmation, ["operationId", "binding", "environmentId", "inventoryHash"]);
  const decoded = decodeAgentWorkspaceDiscardRecovery({ ...input, schemaVersion: 1, state: "pending" }, scope);
  if (!decoded) throw new AgentWorkspaceDecodeError();
  const { schemaVersion: _schema, state: _state, ...confirmation } = decoded;
  const review = decodeAgentWorkspaceReview(record.review);
  if (JSON.stringify(review.binding) !== JSON.stringify(confirmation.binding)) throw new AgentWorkspaceDecodeError();
  return { schemaVersion: 1, confirmation, review };
}
