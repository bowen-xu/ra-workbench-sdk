import { describe, expect, it, vi } from "vitest";
import { AgentPaperSubmissionDecodeError, type AgentPaperRecoveryRequest } from "@research-assistant/core/agent";
import { createAgentPaperRecoveryGateway } from "./paperRecovery";

const conversationId = "11111111-1111-4111-8111-111111111111";
const paperId = "paper-1";
const requestId = "22222222-2222-4222-8222-222222222222";
const turnId = "33333333-3333-4333-8333-333333333333";
const snapshotId = "snapshot-1";
function request(): AgentPaperRecoveryRequest { return { conversationId, paperId, after: null, limit: 20 }; }
function page() { return { schemaVersion: 1, conversationId, paperId, items: [{ requestId, turnId, paperContextSnapshotId: snapshotId, messageExcerpt: "继续", createdAt: "2026-09-11T00:00:00Z" }], nextCursor: null }; }

describe("paper recovery gateway", () => {
  it("lists bounded unstarted submissions", async () => {
    const invoke = vi.fn().mockResolvedValue(page());
    const result = await createAgentPaperRecoveryGateway(invoke).list(request());
    expect(result.items[0]?.paperContextSnapshotId).toBe(snapshotId);
    expect(invoke).toHaveBeenCalledWith("agent_list_unstarted_paper_submissions", { request: request() });
  });
  it("rejects a mismatched page", async () => {
    await expect(createAgentPaperRecoveryGateway(vi.fn().mockResolvedValue({ ...page(), paperId: "other" })).list(request()))
      .rejects.toBeInstanceOf(AgentPaperSubmissionDecodeError);
  });
});
