import { AgentWorkspaceDecodeError, decodeAgentWorkspaceReview, decodeAgentWorkspaceFileReview,
  type AgentWorkspaceScope, type AgentWorkspaceConfirmation, type AgentWorkspaceFileRequest,
  type AgentWorkspaceReview, type AgentWorkspaceFileReview, type AgentFileVersion } from "@research-assistant/core/agent";
import type { AgentMetadataInvoke } from "./index";
import { decodeAgentWorkspaceHistory, type AgentWorkspaceHistoryRequest, type AgentWorkspaceHistoryPage } from "@research-assistant/core/agent";
export interface AgentWorkspaceReviewGateway {
  list(request: AgentWorkspaceHistoryRequest): Promise<AgentWorkspaceHistoryPage>;
  review(request: AgentWorkspaceScope): Promise<AgentWorkspaceReview>;
  reviewBinding(request: AgentWorkspaceConfirmation): Promise<AgentWorkspaceReview>;
  readFile(request: AgentWorkspaceFileRequest): Promise<AgentWorkspaceFileReview>;
}
function checkScope(actual: AgentWorkspaceScope, expected: AgentWorkspaceScope): void {
  for (const key of ["conversationId", "requestId", "manuscriptId", "contextSnapshotId"] as const) {
    if (actual[key] !== expected[key].toLowerCase()) throw new AgentWorkspaceDecodeError();
  }
}
function checkBinding(actual: AgentWorkspaceConfirmation, expected: AgentWorkspaceConfirmation): void {
  checkScope(actual.scope, expected.scope);
  if (actual.turnId !== expected.turnId.toLowerCase() || actual.leaseId !== expected.leaseId.toLowerCase()
    || actual.manifestHash !== expected.manifestHash) throw new AgentWorkspaceDecodeError();
}
function sameVersion(a: AgentFileVersion | null, b: AgentFileVersion | null): boolean {
  return a === null || b === null ? a === b : a.sha256 === b.sha256 && a.byteSize === b.byteSize && a.executable === b.executable;
}
export function createAgentWorkspaceReviewGateway(invoke: AgentMetadataInvoke): AgentWorkspaceReviewGateway {
  return {
    async list(request) {
      request = { ...request };
      return decodeAgentWorkspaceHistory(await invoke("agent_list_writing_workspace_reviews", { request }), request);
    },
    async review(request) {
      request = { ...request };
      const response = decodeAgentWorkspaceReview(await invoke("agent_review_writing_workspace", { request }));
      checkScope(response.binding.scope, request); return response;
    },
    async reviewBinding(request) {
      request = { ...request, scope: { ...request.scope } };
      const response = decodeAgentWorkspaceReview(await invoke("agent_review_writing_workspace_binding", { request }));
      checkBinding(response.binding, request); return response;
    },
    async readFile(request) {
      request = { binding: { ...request.binding, scope: { ...request.binding.scope } }, path: request.path,
        before: request.before && { ...request.before }, after: request.after && { ...request.after } };
      const response = decodeAgentWorkspaceFileReview(await invoke("agent_review_writing_workspace_file", { request }));
      checkBinding(response.binding, request.binding);
      if (response.change.path !== request.path || !sameVersion(response.change.before, request.before)
        || !sameVersion(response.change.after, request.after)) throw new AgentWorkspaceDecodeError();
      return response;
    },
  };
}
