import { describe, expect, it, vi } from "vitest";
import { createAgentPaperSubmissionGateway } from "./paperSubmission";

const conversationId = "a1111111-1111-4111-8111-111111111111";
const requestId = "b1111111-1111-4111-8111-111111111111";
const paperId = "paper-42";
const snapshotId = "snapshot-7";
const turnId = "c1111111-1111-4111-8111-111111111111";
const contextSnapshotId = "d1111111-1111-4111-8111-111111111111";

function preview() {
  return {
    schemaVersion: 1,
    conversationId,
    requestId,
    paperId,
    paperContextSnapshotId: snapshotId,
    turnId,
    contextSnapshotId,
    input: {
      text: "Explain the contribution",
      model: { providerId: "deepseek", modelId: "deepseek-v4-pro", revision: null },
      reasoningEffort: null,
      context: [{
        sourceId: "paper-context:paper-42:0",
        kind: "paper",
        resourceId: paperId,
        revision: "snapshot:7",
        anchor: JSON.stringify({ paperId, snapshotId, attachmentId: "attachment-1", parseRunId: "parse-1", kind: "text", rawRef: "block-1", pageIndex: 0 }),
        text: "Frozen paper text",
      }],
    },
  };
}

describe("paper submission gateway", () => {
  it("freezes request payloads and starts only the confirmed snapshot", async () => {
    const invoke = vi.fn().mockResolvedValueOnce(preview()).mockResolvedValueOnce({
      schemaVersion: 1, conversationId, requestId, turnId, alreadyStarted: false, outcome: null,
    });
    const gateway = createAgentPaperSubmissionGateway(invoke);
    const request = { conversationId, requestId, paperId, paperContextSnapshotId: snapshotId, expectedContextHash: "a".repeat(64), text: "Explain the contribution" };
    const confirmed = await gateway.prepare(request);
    expect(await gateway.start(confirmed, "deepSeekNonThinking")).toMatchObject({ turnId });
    expect(invoke).toHaveBeenNthCalledWith(1, "agent_prepare_paper_submission", { request: { ...request, model: null } });
    expect(invoke).toHaveBeenNthCalledWith(2, "agent_start_paper_submission", { request: {
      conversationId, requestId, paperId, paperContextSnapshotId: snapshotId, contextSnapshotId,
      model: confirmed.input.model, mode: "deepSeekNonThinking",
    }});
  });

  it("rejects mismatched native identities and invalid modes", async () => {
    const wrong = { ...preview(), paperId: "another-paper" };
    const invoke = vi.fn().mockResolvedValue(wrong);
    await expect(createAgentPaperSubmissionGateway(invoke).prepare({
      conversationId, requestId, paperId, paperContextSnapshotId: snapshotId, expectedContextHash: "a".repeat(64), text: "Explain the contribution",
    })).rejects.toThrow();
    expect(invoke).toHaveBeenCalledOnce();
    await expect(createAgentPaperSubmissionGateway(vi.fn()).start(preview() as never, "invented" as never)).rejects.toThrow();
  });

  it("sends the original environment when starting a guarded submission", async () => {
    const epoch = "e1111111-1111-4111-8111-111111111111";
    const invoke = vi.fn().mockResolvedValue({schemaVersion: 1, conversationId, requestId, turnId, alreadyStarted: false, outcome: null});
    await createAgentPaperSubmissionGateway(invoke).start(preview() as never, "chatGptDefault", {expectedEpoch: epoch});
    expect(invoke).toHaveBeenCalledWith("agent_start_paper_submission", expect.objectContaining({expectedEpoch: epoch}));
    await expect(createAgentPaperSubmissionGateway(invoke).start(preview() as never, "chatGptDefault", {expectedEpoch: "invalid"})).rejects.toThrow();
    expect(invoke).toHaveBeenCalledOnce();
  });

  it("accepts an image-only native submission preview", async () => {
    const value = preview();
    const invoke = vi.fn().mockResolvedValue({ ...value, input: { ...value.input, context: [] } });
    const request = { conversationId, requestId, paperId, paperContextSnapshotId: snapshotId, expectedContextHash: "a".repeat(64), text: "Explain the contribution" };
    await expect(createAgentPaperSubmissionGateway(invoke).prepare(request)).resolves.toMatchObject({ input: { context: [] } });
  });

  it("admits text to the active paper turn", async () => {
    const inputId = "e1111111-1111-4111-8111-111111111111";
    const invoke = vi.fn().mockResolvedValue({ schemaVersion: 1, conversationId, turnId, inputId });
    await expect(createAgentPaperSubmissionGateway(invoke).steer({ conversationId, paperId, turnId, inputId, text: "More detail" })).resolves.toMatchObject({ inputId });
    expect(invoke).toHaveBeenCalledWith("agent_steer_paper_turn", { request: { conversationId, paperId, turnId, inputId, text: "More detail" } });
  });

  it("restores historical paper source geometry through the native command", async () => {
    const invoke = vi.fn().mockResolvedValue({
      schemaVersion: 1, conversationId, paperId, turnId,
      sources: [{ sourceId: `paper-source:${"a".repeat(64)}`, id: "P1-T1", attachmentId: "attachment-1", regions: [] }],
    });
    await expect(createAgentPaperSubmissionGateway(invoke).sources({ conversationId, paperId, turnId })).resolves.toMatchObject({ paperId, turnId });
    expect(invoke).toHaveBeenCalledWith("agent_read_paper_turn_sources", { request: { conversationId, paperId, turnId } });
  });
});
