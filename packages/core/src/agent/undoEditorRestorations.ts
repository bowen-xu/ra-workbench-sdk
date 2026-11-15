import { AgentWorkspaceDecodeError, row } from "./workspaceDecoding";
import { decodeAgentApplicationScope, type AgentApplicationScope } from "./proposalApplications";
import { decodeAgentEditorRestorationRequest, decodeAgentEditorRestorationResponse,
  type AgentEditorRestorationRequest, type AgentEditorRestorationResponse } from "./editorRestorations";

export interface AgentUndoEditorRestorationRequest {
  readonly originalScope: AgentApplicationScope;
  readonly request: AgentEditorRestorationRequest;
}
export interface AgentUndoEditorRestorationResponse {
  readonly originalScope: AgentApplicationScope;
  readonly result: AgentEditorRestorationResponse;
}
function checkRelation(original: AgentApplicationScope, undo: AgentApplicationScope, restoreId?: string) {
  if (original.operationId === undo.operationId || restoreId === original.operationId
    || (["conversationId", "manuscriptId", "proposalId"] as const).some(key => original[key] !== undo[key])) {
    throw new AgentWorkspaceDecodeError();
  }
}
export function decodeAgentUndoEditorRestorationRequest(value: unknown): AgentUndoEditorRestorationRequest {
  const r = row(value, ["originalScope", "request"]);
  const originalScope = decodeAgentApplicationScope(r.originalScope), request = decodeAgentEditorRestorationRequest(r.request);
  checkRelation(originalScope, request.scope, request.action === "read" ? undefined : request.restoreId);
  return {originalScope, request};
}
export function decodeAgentUndoEditorRestorationResponse(value: unknown): AgentUndoEditorRestorationResponse {
  const r = row(value, ["originalScope", "result"]);
  const originalScope = decodeAgentApplicationScope(r.originalScope), result = decodeAgentEditorRestorationResponse(r.result);
  checkRelation(originalScope, result.kind === "edit" ? result.scope : result.application.scope,
    result.kind === "edit" ? result.restoreId : result.restoration?.id);
  return {originalScope, result};
}
