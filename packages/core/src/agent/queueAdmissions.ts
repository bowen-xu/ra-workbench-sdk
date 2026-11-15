import { AgentSubmissionDecodeError, decodeAgentSubmissionPreview, decodeAgentWritingQueueScope,
  type AgentSubmissionPreview, type AgentWritingQueueScope } from "./submission";
export interface AgentQueueAdmissionsRequest extends AgentWritingQueueScope {
  readonly after: string | null;
  readonly limit: number;
}
export interface AgentQueueAdmission {
  readonly inputId: string;
  readonly expectedRevision: number;
  readonly preview: AgentSubmissionPreview;
}
export interface AgentQueueAdmissionsPage extends AgentWritingQueueScope {
  readonly schemaVersion: 1;
  readonly items: readonly AgentQueueAdmission[];
  readonly nextCursor: string | null;
}
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AgentSubmissionDecodeError();
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== keys.length || keys.some((key) => !Object.hasOwn(row, key))) throw new AgentSubmissionDecodeError();
  return row;
}
function id(value: unknown): string {
  return decodeAgentWritingQueueScope({ conversationId: value, manuscriptId: value }).conversationId;
}
export function decodeAgentQueueAdmissionsRequest(value: unknown): AgentQueueAdmissionsRequest {
  const row = object(value, ["conversationId", "manuscriptId", "after", "limit"]);
  const scope = decodeAgentWritingQueueScope({ conversationId: row.conversationId, manuscriptId: row.manuscriptId });
  if (typeof row.limit !== "number" || !Number.isInteger(row.limit) || row.limit < 1 || row.limit > 64) throw new AgentSubmissionDecodeError();
  return { ...scope, after: row.after === null ? null : id(row.after), limit: row.limit };
}
export function decodeAgentQueueAdmissionsPage(value: unknown): AgentQueueAdmissionsPage {
  const row = object(value, ["schemaVersion", "conversationId", "manuscriptId", "items", "nextCursor"]);
  if (row.schemaVersion !== 1 || !Array.isArray(row.items) || row.items.length > 64) throw new AgentSubmissionDecodeError();
  const scope = decodeAgentWritingQueueScope({ conversationId: row.conversationId, manuscriptId: row.manuscriptId });
  const items = row.items.map((value): AgentQueueAdmission => {
    const item = object(value, ["inputId", "expectedRevision", "preview"]);
    if (typeof item.expectedRevision !== "number" || !Number.isSafeInteger(item.expectedRevision) || item.expectedRevision < 0) throw new AgentSubmissionDecodeError();
    const preview = decodeAgentSubmissionPreview(item.preview);
    if (preview.conversationId !== scope.conversationId || preview.manuscriptId !== scope.manuscriptId) throw new AgentSubmissionDecodeError();
    return { inputId: id(item.inputId), expectedRevision: item.expectedRevision, preview };
  });
  if (items.some((item, index) => index > 0 && item.inputId <= items[index - 1]!.inputId)
    || new Set(items.map((item) => item.preview.requestId)).size !== items.length
    || new Set(items.map((item) => item.preview.turnId)).size !== items.length) throw new AgentSubmissionDecodeError();
  const nextCursor = row.nextCursor === null ? null : id(row.nextCursor);
  if (nextCursor !== null && nextCursor !== items.at(-1)?.inputId) throw new AgentSubmissionDecodeError();
  return { schemaVersion: 1, ...scope, items, nextCursor };
}
