import { AgentWorkspaceDecodeError, id, row, validPath } from "./workspaceDecoding";
import { decodeAgentApplicationResponse, decodeAgentApplicationScope, decodeAgentEditorObservation,
  type AgentApplicationScope, type AgentApplicationState, type AgentEditorObservation } from "./proposalApplications";

import type { AgentWorkspaceCheckpointVersion } from "./workspace";

export type AgentEditorRestorationRequest =
  | { readonly action: "read"; readonly scope: AgentApplicationScope; readonly path: string }
  | { readonly action: "prepare"; readonly scope: AgentApplicationScope; readonly restoreId: string; readonly current: AgentEditorObservation; readonly checkpointVersion?: AgentWorkspaceCheckpointVersion }
  | { readonly action: "confirm"; readonly scope: AgentApplicationScope; readonly restoreId: string; readonly actual: AgentEditorObservation };
export interface AgentEditorRestoration {
  readonly id: string; readonly sessionId: string; readonly expectedRevision: string; readonly resultRevision: string | null;
}
export interface AgentEditorRestorationState {
  readonly kind: "state"; readonly schemaVersion: 1; readonly application: AgentApplicationState;
  readonly path: string; readonly restoration: AgentEditorRestoration | null;
}
export type AgentEditorRestorationResponse = AgentEditorRestorationState | {
  readonly kind: "edit"; readonly schemaVersion: 1; readonly scope: AgentApplicationScope;
  readonly restoreId: string; readonly expected: AgentEditorObservation; readonly text: string;
};
function restoreId(value: unknown, scope: AgentApplicationScope): string {
  const result=id(value);
  if(result===scope.operationId) throw new AgentWorkspaceDecodeError();
  return result;
}
export function decodeAgentEditorRestorationRequest(value: unknown): AgentEditorRestorationRequest {
  if(!value || typeof value!=="object" || !("action" in value)) throw new AgentWorkspaceDecodeError();
  if(value.action==="read") {
    const r=row(value,["action","scope","path"]);
    if(typeof r.path!=="string" || !validPath(r.path) || r.path.split("/").some(p=>/^\.agent-(?:before|create)-/i.test(p))) throw new AgentWorkspaceDecodeError();
    return {action:"read",scope:decodeAgentApplicationScope(r.scope),path:r.path};
  }
  if(value.action!=="prepare" && value.action!=="confirm") throw new AgentWorkspaceDecodeError();
  const proof = value.action === "prepare" && "checkpointVersion" in value;
  const r=row(value,["action","scope","restoreId",value.action==="prepare" ? "current" : "actual", ...(proof ? ["checkpointVersion"] : [])]);
  let checkpointVersion: AgentWorkspaceCheckpointVersion | undefined;
  if (proof) {
    const p = row(r.checkpointVersion, ["path", "revision", "stateVersion"]), current = decodeAgentEditorObservation(r.current);
    if (p.path !== current.path || typeof p.revision !== "number" || !Number.isSafeInteger(p.revision) || p.revision < 1
      || typeof p.stateVersion !== "number" || !Number.isSafeInteger(p.stateVersion) || p.stateVersion < 0) throw new AgentWorkspaceDecodeError();
    checkpointVersion = { path: current.path, revision: p.revision, stateVersion: p.stateVersion };
  }
  const scope=decodeAgentApplicationScope(r.scope), identity=restoreId(r.restoreId,scope);
  return value.action==="prepare" ? {action:"prepare",scope,restoreId:identity,current:decodeAgentEditorObservation(r.current), ...(checkpointVersion ? { checkpointVersion } : {})}
    : {action:"confirm",scope,restoreId:identity,actual:decodeAgentEditorObservation(r.actual)};
}
export function decodeAgentEditorRestorationResponse(value: unknown): AgentEditorRestorationResponse {
  if(!value || typeof value!=="object" || !("kind" in value)) throw new AgentWorkspaceDecodeError();
  if(value.kind==="edit") {
    const r=row(value,["kind","schemaVersion","scope","restoreId","expected","text"]);
    const {restoreId:identity,...edit}=r;
    const result=decodeAgentApplicationResponse(edit);
    if(result.kind!=="edit") throw new AgentWorkspaceDecodeError();
    return {...result,restoreId:restoreId(identity,result.scope)};
  }
  const r=row(value,["kind","schemaVersion","application","path","restoration"]);
  if(r.kind!=="state" || r.schemaVersion!==1) throw new AgentWorkspaceDecodeError();
  const application=decodeAgentApplicationResponse(r.application);
  if(application.kind!=="state" || typeof r.path!=="string") throw new AgentWorkspaceDecodeError();
  const file=application.files.find(f=>f.path===r.path);
  if(!file || file.target.kind!=="editor") throw new AgentWorkspaceDecodeError();
  let restoration: AgentEditorRestoration | null=null;
  if(r.restoration!==null) {
    const s=row(r.restoration,["id","sessionId","expectedRevision","resultRevision"]);
    restoration={id:restoreId(s.id,application.scope),sessionId:id(s.sessionId),expectedRevision:id(s.expectedRevision),resultRevision:s.resultRevision===null?null:id(s.resultRevision)};
    if((restoration.sessionId===file.target.sessionId && restoration.expectedRevision!==file.target.resultRevision)
      || file.target.resultRevision === null
      || restoration.resultRevision===restoration.expectedRevision
      || (application.status!=="recoveryRequired" && application.status!=="rolledBack")
      || (restoration.resultRevision===null ? file.phase!=="acknowledged" : file.phase!=="restored")) throw new AgentWorkspaceDecodeError();
  } else if(file.phase==="restored") throw new AgentWorkspaceDecodeError();
  return {kind:"state",schemaVersion:1,application,path:r.path,restoration};
}
