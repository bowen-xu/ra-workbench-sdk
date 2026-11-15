import { AgentWorkspaceDecodeError, id, row } from "./workspaceDecoding";
import { decodeAgentWorkspaceReview, decodeAgentWorkspaceFileReview, type AgentWorkspaceReview, type AgentWorkspaceFileReview } from "./workspaceReview";
export interface AgentProposalRequest { readonly conversationId: string; readonly manuscriptId: string; readonly proposalId: string }
export interface AgentProposalFileRequest { readonly proposal: AgentProposalRequest; readonly path: string }
const statuses = ["pending", "rejected", "applying", "applied", "conflict", "recovery_required", "undone"] as const;
export interface AgentProposalReview { readonly schemaVersion: 1; readonly proposalId: string; readonly status: typeof statuses[number]; readonly review: AgentWorkspaceReview }
export interface AgentProposalFileReview { readonly schemaVersion: 1; readonly proposalId: string; readonly file: AgentWorkspaceFileReview }
export function decodeAgentProposalReview(value: unknown): AgentProposalReview {
  const r = row(value, ["schemaVersion", "proposalId", "status", "review"]);
  if (r.schemaVersion !== 1 || !statuses.some(status => status === r.status)) throw new AgentWorkspaceDecodeError();
  const review = decodeAgentWorkspaceReview(r.review);
  if (!review.changes.length) throw new AgentWorkspaceDecodeError();
  return { schemaVersion: 1, proposalId: id(r.proposalId), status: r.status as AgentProposalReview["status"], review };
}
export function decodeAgentProposalFileReview(value: unknown): AgentProposalFileReview {
  const r = row(value, ["schemaVersion", "proposalId", "file"]);
  if (r.schemaVersion !== 1) throw new AgentWorkspaceDecodeError();
  return { schemaVersion: 1, proposalId: id(r.proposalId), file: decodeAgentWorkspaceFileReview(r.file) };
}
