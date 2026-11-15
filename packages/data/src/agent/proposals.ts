import { AgentWorkspaceDecodeError, decodeAgentWorkspaceReview, decodeAgentProposalReview, decodeAgentProposalFileReview,
  type AgentWorkspaceScope, type AgentWorkspaceReview, type AgentWorkspaceConfirmation, type AgentProposalRequest, type AgentProposalFileRequest,
  type AgentProposalReview, type AgentProposalFileReview } from "@research-assistant/core/agent";
import type { AgentMetadataInvoke } from "./index";
export interface AgentProposalGateway {
  latest(scope: AgentWorkspaceScope): Promise<AgentProposalReview | null>;
  publish(review: AgentWorkspaceReview): Promise<AgentProposalReview>;
  review(request: AgentProposalRequest): Promise<AgentProposalReview>;
  reject(request: AgentProposalRequest): Promise<AgentProposalReview>;
  readFile(request: AgentProposalFileRequest): Promise<AgentProposalFileReview>;
}
function check(id: string, binding: AgentWorkspaceConfirmation, request: AgentProposalRequest): void {
  if (id !== request.proposalId.toLowerCase() || binding.scope.conversationId !== request.conversationId.toLowerCase()
    || binding.scope.manuscriptId !== request.manuscriptId.toLowerCase()) throw new AgentWorkspaceDecodeError();
}
export function createAgentProposalGateway(invoke: AgentMetadataInvoke): AgentProposalGateway {
  return {
    async latest(value) {
      const request = { ...value };
      const raw = await invoke("agent_latest_writing_proposal", { request });
      if (raw === null) return null;
      const result = decodeAgentProposalReview(raw);
      for (const key of ["conversationId", "manuscriptId", "requestId", "contextSnapshotId"] as const) {
        if (result.review.binding.scope[key] !== request[key].toLowerCase()) throw new AgentWorkspaceDecodeError();
      }
      return result;
    },
    async publish(value) {
      // Decoder creates a deep snapshot so caller edits cannot change pending checks.
      const review = decodeAgentWorkspaceReview(value);
      const request = { binding: review.binding, changes: review.changes.map(c => ({ path: c.path, before: c.before, after: c.after })) };
      const result = decodeAgentProposalReview(await invoke("agent_publish_writing_proposal", { request }));
      if (JSON.stringify(result.review) !== JSON.stringify(review)) throw new AgentWorkspaceDecodeError();
      return result;
    },
    async review(value) {
      const request = { ...value };
      const result = decodeAgentProposalReview(await invoke("agent_review_writing_proposal", { request }));
      check(result.proposalId, result.review.binding, request); return result;
    },
    async reject(value) {
      const request = { ...value };
      const result = decodeAgentProposalReview(await invoke("agent_reject_writing_proposal", { request }));
      check(result.proposalId, result.review.binding, request);
      if (result.status !== "rejected") throw new AgentWorkspaceDecodeError();
      return result;
    },
    async readFile(value) {
      const request = { proposal: { ...value.proposal }, path: value.path };
      const result = decodeAgentProposalFileReview(await invoke("agent_review_writing_proposal_file", { request }));
      check(result.proposalId, result.file.binding, request.proposal);
      if (result.file.change.path !== request.path) throw new AgentWorkspaceDecodeError();
      return result;
    },
  };
}
