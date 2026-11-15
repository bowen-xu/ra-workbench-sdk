import { utf8Length } from "./workspaceDecoding";
import { AgentPaperSubmissionDecodeError } from "./paperSubmission";

export interface AgentPaperRecoveryRequest { readonly conversationId: string; readonly paperId: string; readonly after: string | null; readonly limit: number }
export interface AgentPaperRecoveryCandidate { readonly requestId: string; readonly turnId: string; readonly paperContextSnapshotId: string; readonly messageExcerpt: string; readonly createdAt: string }
export interface AgentPaperRecoveryPage { readonly schemaVersion: 1; readonly conversationId: string; readonly paperId: string; readonly items: readonly AgentPaperRecoveryCandidate[]; readonly nextCursor: string | null }

function fail(): never { throw new AgentPaperSubmissionDecodeError(); }
function row(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const data = value as Record<string, unknown>;
  if (Object.keys(data).length !== keys.length || keys.some((key) => !Object.hasOwn(data, key))) return fail();
  return data;
}
function uuid(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value) || value === "00000000-0000-0000-0000-000000000000") return fail();
  return value.toLowerCase();
}
function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || utf8Length(value) > 256 || value.includes("\0")) return fail();
  return value;
}
export function decodeAgentPaperRecoveryRequest(value: unknown): AgentPaperRecoveryRequest {
  const data = row(value, ["conversationId", "paperId", "after", "limit"]);
  if (typeof data.limit !== "number" || !Number.isSafeInteger(data.limit) || data.limit < 1 || data.limit > 64) return fail();
  return { conversationId: uuid(data.conversationId), paperId: text(data.paperId), after: data.after === null ? null : uuid(data.after), limit: data.limit };
}
export function decodeAgentPaperRecoveryPage(value: unknown, scope: AgentPaperRecoveryRequest): AgentPaperRecoveryPage {
  const expected = decodeAgentPaperRecoveryRequest(scope);
  const data = row(value, ["schemaVersion", "conversationId", "paperId", "items", "nextCursor"]);
  if (data.schemaVersion !== 1 || uuid(data.conversationId) !== expected.conversationId || text(data.paperId) !== expected.paperId || !Array.isArray(data.items) || data.items.length > expected.limit) return fail();
  let previous = expected.after; const turns = new Set<string>();
  const items = data.items.map((value) => {
    const item = row(value, ["requestId", "turnId", "paperContextSnapshotId", "messageExcerpt", "createdAt"]);
    const requestId = uuid(item.requestId), turnId = uuid(item.turnId), snapshotId = text(item.paperContextSnapshotId);
    if ((previous !== null && requestId <= previous) || turns.has(turnId) || typeof item.messageExcerpt !== "string" || [...item.messageExcerpt].length > 200 || item.messageExcerpt.includes("\0") || typeof item.createdAt !== "string" || item.createdAt.length > 40 || !Number.isFinite(Date.parse(item.createdAt))) return fail();
    previous = requestId; turns.add(turnId);
    return { requestId, turnId, paperContextSnapshotId: snapshotId, messageExcerpt: item.messageExcerpt, createdAt: item.createdAt };
  });
  const nextCursor = data.nextCursor === null ? null : uuid(data.nextCursor);
  const required = items.length === expected.limit ? items.at(-1)?.requestId ?? null : null;
  if (nextCursor !== required) return fail();
  return { schemaVersion: 1, conversationId: expected.conversationId, paperId: expected.paperId, items, nextCursor };
}
