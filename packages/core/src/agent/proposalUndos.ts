import { AgentWorkspaceDecodeError, id, row, validPath } from "./workspaceDecoding";
import { decodeAgentApplicationResponse, decodeAgentApplicationScope, decodeAgentEditorObservation, decodeAgentCheckpointedBuffers,
  type AgentApplicationResponse, type AgentApplicationScope, type AgentEditorObservation } from "./proposalApplications";
import type { AgentWorkspaceBuffer, AgentWorkspaceCheckpointVersion } from "./workspace";

/** CAS evidence for the file-owned checkpoint, never a replacement editor receipt. */
export type AgentUndoCheckpointVersion = AgentWorkspaceCheckpointVersion;
export type AgentUndoCommand =
  | { readonly action: "read" | "defer" | "cancelPending" }
  | { readonly action: "prepare" | "start"; readonly buffers: readonly AgentWorkspaceBuffer[] }
  | { readonly action: "resume" | "prepareRollback" | "rollbackDisk"; readonly buffers: readonly AgentWorkspaceBuffer[]; readonly checkpointVersions?: readonly AgentUndoCheckpointVersion[] }
  | { readonly action: "applyDisk" | "reconcileDisk"; readonly path: string }
  | { readonly action: "prepareEditor"; readonly current: AgentEditorObservation }
  | { readonly action: "confirmEditor"; readonly actual: AgentEditorObservation };
export interface AgentUndoRequest {
  readonly scope: AgentApplicationScope;
  readonly undoId: string;
  readonly command: AgentUndoCommand;
}
export interface AgentUndoResponse {
  readonly schemaVersion: 1;
  readonly originalScope: AgentApplicationScope;
  readonly undoId: string;
  readonly result: AgentApplicationResponse | null;
}
function identity(value: unknown, scope: AgentApplicationScope): string {
  const result = id(value);
  if (result === scope.operationId) throw new AgentWorkspaceDecodeError();
  return result;
}
function command(value: unknown): AgentUndoCommand {
  if (!value || typeof value !== "object" || !("action" in value)) throw new AgentWorkspaceDecodeError();
  switch (value.action) {
    case "read": case "defer": case "cancelPending":
      row(value, ["action"]);
      return { action: value.action };
    case "applyDisk": case "reconcileDisk": {
      const r = row(value, ["action", "path"]);
      if (typeof r.path !== "string" || !validPath(r.path) || r.path.split("/").some(p => /^\.agent-(?:before|create)-/i.test(p))) throw new AgentWorkspaceDecodeError();
      return { action: value.action, path: r.path };
    }
    case "prepareEditor": {
      const r = row(value, ["action", "current"]);
      return { action: value.action, current: decodeAgentEditorObservation(r.current) };
    }
    case "confirmEditor": {
      const r = row(value, ["action", "actual"]);
      return { action: value.action, actual: decodeAgentEditorObservation(r.actual) };
    }
    case "prepare": case "start": case "resume": case "prepareRollback": case "rollbackDisk": {
      const withVersions = ["resume", "prepareRollback", "rollbackDisk"].includes(value.action as string) && "checkpointVersions" in value;
      const r = row(value, withVersions ? ["action", "buffers", "checkpointVersions"] : ["action", "buffers"]);
      return { action: value.action, ...decodeAgentCheckpointedBuffers({buffers: r.buffers,
        ...(withVersions ? {checkpointVersions: r.checkpointVersions} : {})}) };
    }
    default: throw new AgentWorkspaceDecodeError();
  }
}
export function decodeAgentUndoRequest(value: unknown): AgentUndoRequest {
  const r = row(value, ["scope", "undoId", "command"]);
  const scope = decodeAgentApplicationScope(r.scope);
  return { scope, undoId: identity(r.undoId, scope), command: command(r.command) };
}
export function decodeAgentUndoResponse(value: unknown): AgentUndoResponse {
  const r = row(value, ["schemaVersion", "originalScope", "undoId", "result"]);
  if (r.schemaVersion !== 1) throw new AgentWorkspaceDecodeError();
  const originalScope = decodeAgentApplicationScope(r.originalScope);
  const undoId = identity(r.undoId, originalScope);
  const result = r.result === null ? null : decodeAgentApplicationResponse(r.result);
  if (result) {
    for (const key of ["conversationId", "manuscriptId", "proposalId"] as const) {
      if (result.scope[key] !== originalScope[key]) throw new AgentWorkspaceDecodeError();
    }
    if (result.scope.operationId !== undoId) throw new AgentWorkspaceDecodeError();
  }
  return { schemaVersion: 1, originalScope, undoId, result };
}
