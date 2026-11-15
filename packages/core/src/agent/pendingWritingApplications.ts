import { AgentWorkspaceDecodeError, id, row } from "./workspaceDecoding";
import { decodeAgentApplicationResponse, type AgentApplicationState } from "./proposalApplications";

export interface AgentPendingWritingApplicationRequest {
  readonly manuscriptId: string;
  readonly after: number | null;
  readonly limit: number;
}
export interface AgentPendingWritingApplicationEntry {
  readonly id: number;
  readonly application: AgentApplicationState;
}
export interface AgentPendingWritingApplicationPage {
  readonly schemaVersion: 1;
  readonly manuscriptId: string;
  readonly items: readonly AgentPendingWritingApplicationEntry[];
  readonly nextCursor: number | null;
}
function ordinal(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new AgentWorkspaceDecodeError();
  return value;
}
export function decodeAgentPendingWritingApplicationRequest(value: unknown): AgentPendingWritingApplicationRequest {
  const data = row(value, ["manuscriptId", "after", "limit"]);
  if (typeof data.limit !== "number" || !Number.isInteger(data.limit) || data.limit < 1 || data.limit > 64) throw new AgentWorkspaceDecodeError();
  return { manuscriptId: id(data.manuscriptId), after: data.after === null ? null : ordinal(data.after), limit: data.limit };
}
/** A file journal snapshot never authorizes execution or installs historical text. */
export function decodeAgentPendingWritingApplicationPage(value: unknown): AgentPendingWritingApplicationPage {
  const data = row(value, ["schemaVersion", "manuscriptId", "items", "nextCursor"]);
  if (data.schemaVersion !== 1 || !Array.isArray(data.items) || data.items.length > 64) throw new AgentWorkspaceDecodeError();
  const manuscriptId = id(data.manuscriptId);
  const items = data.items.map((value): AgentPendingWritingApplicationEntry => {
    const entry = row(value, ["id", "application"]);
    const application = decodeAgentApplicationResponse(entry.application);
    if (application.kind !== "state" || application.scope.manuscriptId !== manuscriptId) throw new AgentWorkspaceDecodeError();
    const phase = application.status === "applied" ? "acknowledged" : "restored";
    if (["applied", "rolledBack"].includes(application.status)
      && !application.files.some(file => file.target.kind === "editor" && file.phase === phase)) throw new AgentWorkspaceDecodeError();
    return { id: ordinal(entry.id), application };
  });
  if (items.some((item, index) => index > 0 && item.id <= items[index - 1]!.id)
    || new Set(items.map(item => item.application.scope.operationId)).size !== items.length
    || new Set(items.map(item => item.application.scope.proposalId)).size !== items.length) throw new AgentWorkspaceDecodeError();
  const nextCursor = data.nextCursor === null ? null : ordinal(data.nextCursor);
  if (nextCursor !== null && nextCursor !== items.at(-1)?.id) throw new AgentWorkspaceDecodeError();
  return { schemaVersion: 1, manuscriptId, items, nextCursor };
}
