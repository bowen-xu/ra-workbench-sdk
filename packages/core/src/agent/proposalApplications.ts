import { AgentWorkspaceDecodeError, id, row, utf8Length, validPath } from "./workspaceDecoding";
import type { AgentWorkspaceBuffer, AgentWorkspaceCheckpointVersion } from "./workspace";

export interface AgentApplicationScope {
  readonly conversationId: string; readonly manuscriptId: string;
  readonly proposalId: string; readonly operationId: string;
}
export interface AgentEditorObservation {
  readonly path: string; readonly sessionId: string; readonly revision: string; readonly text: string;
}
export type AgentApplicationRequest =
  | { readonly action: "begin"; readonly scope: AgentApplicationScope; readonly buffers: readonly AgentWorkspaceBuffer[] }
  | { readonly action: "resume"; readonly scope: AgentApplicationScope; readonly buffers: readonly AgentWorkspaceBuffer[] }
  | { readonly action: "read"; readonly scope: AgentApplicationScope }
  | { readonly action: "rollbackDisk"; readonly scope: AgentApplicationScope }
  | { readonly action: "prepareRollback"; readonly scope: AgentApplicationScope; readonly buffers: readonly AgentWorkspaceBuffer[]; readonly checkpointVersions?: readonly AgentWorkspaceCheckpointVersion[] }
  | { readonly action: "rollbackRemainder"; readonly scope: AgentApplicationScope; readonly buffers?: readonly AgentWorkspaceBuffer[]; readonly checkpointVersions?: readonly AgentWorkspaceCheckpointVersion[] }
  | { readonly action: "applyDisk"; readonly scope: AgentApplicationScope; readonly path: string }
  | { readonly action: "reconcileDisk"; readonly scope: AgentApplicationScope; readonly path: string }
  | { readonly action: "prepareEditor"; readonly scope: AgentApplicationScope; readonly current: AgentEditorObservation }
  | { readonly action: "confirmEditor"; readonly scope: AgentApplicationScope; readonly actual: AgentEditorObservation }
  | { readonly action: "deferEditor"; readonly scope: AgentApplicationScope; readonly path: string };
const statuses = ["prepared", "applying", "applied", "recoveryRequired", "rolledBack"] as const;
const phases = ["pending", "dispatched", "acknowledged", "restored", "conflict"] as const;
export interface AgentApplicationFile {
  readonly path: string; readonly phase: typeof phases[number];
  readonly target: { readonly kind: "disk" } | { readonly kind: "editor"; readonly sessionId: string; readonly revision: string; readonly resultRevision: string | null };
}
export interface AgentApplicationState {
  readonly kind: "state"; readonly schemaVersion: 1; readonly scope: AgentApplicationScope;
  readonly status: typeof statuses[number]; readonly files: readonly AgentApplicationFile[];
}
export interface AgentApplicationEdit {
  readonly kind: "edit"; readonly schemaVersion: 1; readonly scope: AgentApplicationScope;
  readonly expected: AgentEditorObservation; readonly text: string;
}
export type AgentApplicationResponse = AgentApplicationState | AgentApplicationEdit;
export function decodeAgentApplicationScope(value: unknown): AgentApplicationScope {
  const r=row(value,["conversationId","manuscriptId","proposalId","operationId"]);
  return {conversationId:id(r.conversationId),manuscriptId:id(r.manuscriptId),proposalId:id(r.proposalId),operationId:id(r.operationId)};
}
function path(value: unknown): string {
  if(typeof value!=="string" || !validPath(value) || value.split("/").some(p=>/^\.agent-(?:before|create)-/i.test(p))) throw new AgentWorkspaceDecodeError();
  return value;
}
function text(value: unknown): string {
  if(typeof value!=="string" || utf8Length(value)>4*1024*1024) throw new AgentWorkspaceDecodeError();
  return value;
}
export function decodeAgentEditorObservation(value: unknown): AgentEditorObservation {
  const r=row(value,["path","sessionId","revision","text"]);
  return {path:path(r.path),sessionId:id(r.sessionId),revision:id(r.revision),text:text(r.text)};
}
/** Original application and independent Undo use the same file CAS evidence. */
export function decodeAgentCheckpointedBuffers(value: unknown): {
  readonly buffers: readonly AgentWorkspaceBuffer[];
  readonly checkpointVersions?: readonly AgentWorkspaceCheckpointVersion[];
} {
  const withVersions = !!value && typeof value === "object" && "checkpointVersions" in value;
  const r = row(value, withVersions ? ["buffers", "checkpointVersions"] : ["buffers"]);
  if (!Array.isArray(r.buffers) || r.buffers.length > 20_000) throw new AgentWorkspaceDecodeError();
  const seen = new Set<string>();
  const buffers = r.buffers.map((value): AgentWorkspaceBuffer => {
    const b = row(value, ["path", "expectedDiskSha256", "sessionId", "revision", "text"]);
    const { expectedDiskSha256, ...observation } = b;
    const decoded = decodeAgentEditorObservation(observation);
    if (typeof expectedDiskSha256 !== "string" || !/^[0-9a-f]{64}$/.test(expectedDiskSha256) || seen.has(decoded.path)) throw new AgentWorkspaceDecodeError();
    seen.add(decoded.path);
    return { ...decoded, expectedDiskSha256 };
  });
  if (!withVersions) return { buffers };
  if (!Array.isArray(r.checkpointVersions) || r.checkpointVersions.length > buffers.length) throw new AgentWorkspaceDecodeError();
  const paths = new Set<string>();
  const checkpointVersions = r.checkpointVersions.map((value): AgentWorkspaceCheckpointVersion => {
    const c = row(value, ["path", "revision", "stateVersion"]);
    if (typeof c.path !== "string" || !seen.has(c.path) || paths.has(c.path)
      || typeof c.revision !== "number" || !Number.isSafeInteger(c.revision) || c.revision < 1
      || typeof c.stateVersion !== "number" || !Number.isSafeInteger(c.stateVersion) || c.stateVersion < 0) throw new AgentWorkspaceDecodeError();
    paths.add(c.path);
    return { path: c.path, revision: c.revision, stateVersion: c.stateVersion };
  });
  return { buffers, checkpointVersions };
}
export function decodeAgentApplicationRequest(value: unknown): AgentApplicationRequest {
  if (!value || typeof value !== "object" || !("action" in value)) throw new AgentWorkspaceDecodeError();
  switch (value.action) {
    case "begin": case "resume": case "prepareRollback": {
      const withVersions = value.action === "prepareRollback" && "checkpointVersions" in value;
      const r = row(value, ["action", "scope", "buffers", ...(withVersions ? ["checkpointVersions"] : [])]);
      return { action: value.action, scope: decodeAgentApplicationScope(r.scope), ...decodeAgentCheckpointedBuffers({buffers: r.buffers,
        ...(withVersions ? {checkpointVersions: r.checkpointVersions} : {})}) };
    }
    case "rollbackRemainder": {
      const withBuffers = "buffers" in value, withVersions = "checkpointVersions" in value;
      if (withVersions && !withBuffers) throw new AgentWorkspaceDecodeError();
      const r = row(value, ["action", "scope", ...(withBuffers ? ["buffers"] : []), ...(withVersions ? ["checkpointVersions"] : [])]);
      return {action: value.action, scope: decodeAgentApplicationScope(r.scope), ...(withBuffers ? decodeAgentCheckpointedBuffers({buffers: r.buffers,
        ...(withVersions ? {checkpointVersions: r.checkpointVersions} : {})}) : {})};
    }
    case "read": case "rollbackDisk": {
      const r = row(value, ["action", "scope"]);
      return {action: value.action, scope: decodeAgentApplicationScope(r.scope)};
    }
    case "applyDisk": case "reconcileDisk": case "deferEditor": {
      const r = row(value, ["action", "scope", "path"]);
      return {action: value.action, scope: decodeAgentApplicationScope(r.scope), path: path(r.path)};
    }
    case "prepareEditor": {
      const r = row(value, ["action", "scope", "current"]);
      return {action: value.action, scope: decodeAgentApplicationScope(r.scope), current: decodeAgentEditorObservation(r.current)};
    }
    case "confirmEditor": {
      const r = row(value, ["action", "scope", "actual"]);
      return {action: value.action, scope: decodeAgentApplicationScope(r.scope), actual: decodeAgentEditorObservation(r.actual)};
    }
    default: throw new AgentWorkspaceDecodeError();
  }
}
export function decodeAgentApplicationResponse(value: unknown): AgentApplicationResponse {
  if(!value || typeof value!=="object" || !("kind" in value)) throw new AgentWorkspaceDecodeError();
  if(value.kind === "edit") {
    const r=row(value,["kind","schemaVersion","scope","expected","text"]);
    if(r.schemaVersion!==1) throw new AgentWorkspaceDecodeError();
    const expected=decodeAgentEditorObservation(r.expected), after=text(r.text);
    if(after===expected.text) throw new AgentWorkspaceDecodeError();
    return {kind:"edit",schemaVersion:1,scope:decodeAgentApplicationScope(r.scope),expected,text:after};
  }
  const r=row(value,["kind","schemaVersion","scope","status","files"]);
  if(r.kind!=="state" || r.schemaVersion!==1 || !statuses.some(s=>s===r.status) || !Array.isArray(r.files) || !r.files.length || r.files.length>20_000) throw new AgentWorkspaceDecodeError();
  const seen=new Set<string>();
  const files=r.files.map((value): AgentApplicationFile=>{
    const f=row(value,["path","phase","target"]), name=path(f.path);
    if(seen.has(name) || !phases.some(p=>p===f.phase)) throw new AgentWorkspaceDecodeError();
    seen.add(name);
    const phase=f.phase as AgentApplicationFile["phase"];
    if((r.status==="applied" && phase!=="acknowledged") || (r.status==="prepared" && phase!=="pending") || (r.status==="rolledBack" && phase!=="pending" && phase!=="restored")) throw new AgentWorkspaceDecodeError();
    if(f.target && typeof f.target==="object" && "kind" in f.target && f.target.kind==="disk") {
      row(f.target,["kind"]); return {path:name,phase,target:{kind:"disk"}};
    }
    const t=row(f.target,["kind","sessionId","revision","resultRevision"]);
    if(t.kind!=="editor") throw new AgentWorkspaceDecodeError();
    const revision=id(t.revision), resultRevision=t.resultRevision===null ? null : id(t.resultRevision);
    if((phase==="acknowledged" && resultRevision===null) || (phase==="pending" && resultRevision!==null) || resultRevision===revision) throw new AgentWorkspaceDecodeError();
    return {path:name,phase,target:{kind:"editor",sessionId:id(t.sessionId),revision,resultRevision}};
  });
  return {kind:"state",schemaVersion:1,scope:decodeAgentApplicationScope(r.scope),status:r.status as AgentApplicationState["status"],files};
}
