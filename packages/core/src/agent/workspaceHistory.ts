import type { AgentWorkspaceScope } from "./workspace";
import { AgentWorkspaceDecodeError, row, id } from "./workspaceDecoding";

export interface AgentWorkspaceHistoryRequest {
  readonly conversationId: string;
  readonly manuscriptId: string;
  readonly cursor: string | null;
  readonly limit: number;
}
export interface AgentWorkspaceHistoryEntry {
  /** Confirmed change identity; independent of disposable execution bindings. */
  readonly publishedProposalId?: string;
  readonly scope: AgentWorkspaceScope;
  readonly turnId: string;
  readonly createdAt: string;
}
export interface AgentWorkspaceHistoryPage {
  readonly schemaVersion: 1;
  readonly entries: readonly AgentWorkspaceHistoryEntry[];
  readonly nextCursor: string | null;
}
/** Validate a page against the frozen query before exposing identities to UI. */
export function decodeAgentWorkspaceHistory(value: unknown, request: AgentWorkspaceHistoryRequest): AgentWorkspaceHistoryPage {
  const conversation = id(request.conversationId); const manuscript = id(request.manuscriptId);
  const cursor = request.cursor === null ? null : id(request.cursor);
  if (!Number.isInteger(request.limit) || request.limit < 1 || request.limit > 100) throw new AgentWorkspaceDecodeError();
  const page = row(value, ["schemaVersion", "entries", "nextCursor"]);
  if (page.schemaVersion !== 1 || !Array.isArray(page.entries) || page.entries.length > request.limit) throw new AgentWorkspaceDecodeError();
  const seen = new Set<string>(); const turns = new Set<string>();
  const entries = page.entries.map((value): AgentWorkspaceHistoryEntry => {
    const hasPublished = value !== null && typeof value === "object" && "publishedProposalId" in value;
    const entry = row(value, ["scope", "turnId", "createdAt", ...(hasPublished ? ["publishedProposalId"] : [])]);
    const scope = row(entry.scope, ["conversationId", "manuscriptId", "requestId", "contextSnapshotId"]);
    const decoded = { conversationId: id(scope.conversationId), manuscriptId: id(scope.manuscriptId), requestId: id(scope.requestId), contextSnapshotId: id(scope.contextSnapshotId) };
    const turnId = id(entry.turnId);
    if (decoded.conversationId !== conversation || decoded.manuscriptId !== manuscript || decoded.requestId === cursor
      || seen.has(decoded.requestId) || turns.has(turnId) || typeof entry.createdAt !== "string"
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(entry.createdAt)
      || !Number.isFinite(Date.parse(entry.createdAt)) || new Date(entry.createdAt).toISOString() !== entry.createdAt) throw new AgentWorkspaceDecodeError();
    seen.add(decoded.requestId); turns.add(turnId);
    return { scope: decoded, turnId, createdAt: entry.createdAt,
      ...(entry.publishedProposalId === undefined ? {} : { publishedProposalId: id(entry.publishedProposalId) }) };
  });
  for (let index = 1; index < entries.length; index++) {
    const previous = entries[index - 1]; const current = entries[index];
    if (previous && current && (previous.createdAt < current.createdAt
      || (previous.createdAt === current.createdAt && previous.scope.requestId <= current.scope.requestId))) throw new AgentWorkspaceDecodeError();
  }
  const nextCursor = page.nextCursor === null ? null : id(page.nextCursor);
  if (nextCursor !== null && (entries.length !== request.limit || nextCursor !== entries.at(-1)?.scope.requestId)) throw new AgentWorkspaceDecodeError();
  return { schemaVersion: 1, entries, nextCursor };
}
