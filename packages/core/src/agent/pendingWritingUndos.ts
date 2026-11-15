import { AgentWorkspaceDecodeError, id, row } from "./workspaceDecoding";
import { decodeAgentUndoResponse, type AgentUndoResponse } from "./proposalUndos";

export interface AgentPendingWritingUndoRequest {
  readonly manuscriptId: string;
  readonly after: number | null;
  readonly limit: number;
}
export interface AgentPendingWritingUndoEntry {
  readonly id: number;
  readonly undo: AgentUndoResponse;
}
export interface AgentPendingWritingUndoPage {
  readonly schemaVersion: 1;
  readonly manuscriptId: string;
  readonly items: readonly AgentPendingWritingUndoEntry[];
  readonly nextCursor: number | null;
}
function ordinal(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new AgentWorkspaceDecodeError();
  return value;
}
export function decodeAgentPendingWritingUndoRequest(value: unknown): AgentPendingWritingUndoRequest {
  const data = row(value, ["manuscriptId", "after", "limit"]);
  if (typeof data.limit !== "number" || !Number.isInteger(data.limit) || data.limit < 1 || data.limit > 64) throw new AgentWorkspaceDecodeError();
  return { manuscriptId: id(data.manuscriptId), after: data.after === null ? null : ordinal(data.after), limit: data.limit };
}
/** Discovery is a read-only snapshot, never an instruction to repeat a write. */
export function decodeAgentPendingWritingUndoPage(value: unknown): AgentPendingWritingUndoPage {
  const data = row(value, ["schemaVersion", "manuscriptId", "items", "nextCursor"]);
  if (data.schemaVersion !== 1 || !Array.isArray(data.items) || data.items.length > 64) throw new AgentWorkspaceDecodeError();
  const manuscriptId = id(data.manuscriptId);
  const items = data.items.map((value): AgentPendingWritingUndoEntry => {
    const entry = row(value, ["id", "undo"]);
    const undo = decodeAgentUndoResponse(entry.undo);
    if (undo.originalScope.manuscriptId !== manuscriptId || undo.result?.kind !== "state") throw new AgentWorkspaceDecodeError();
    const phase = undo.result.status === "applied" ? "acknowledged" : "restored";
    if (["applied", "rolledBack"].includes(undo.result.status)
      && !undo.result.files.some(file => file.target.kind === "editor"
        && file.phase === phase)) throw new AgentWorkspaceDecodeError();
    return { id: ordinal(entry.id), undo };
  });
  if (items.some((item, index) => index > 0 && item.id <= items[index - 1]!.id)
    || new Set(items.map(item => item.undo.undoId)).size !== items.length
    || new Set(items.map(item => JSON.stringify(item.undo.originalScope))).size !== items.length) throw new AgentWorkspaceDecodeError();
  const nextCursor = data.nextCursor === null ? null : ordinal(data.nextCursor);
  if (nextCursor !== null && nextCursor !== items.at(-1)?.id) throw new AgentWorkspaceDecodeError();
  return { schemaVersion: 1, manuscriptId, items, nextCursor };
}
