import { describe, expect, it, vi } from "vitest";
import { createAgentPaperContextGateway } from "./paperContext";

const request = { paperId: "paper-42", attachmentIds: ["attachment-1"] };
const contextHash = "a".repeat(64);

describe("paper context gateway", () => {
  it("freezes the attachment list before invoking native preparation", async () => {
    const invoke = vi.fn().mockResolvedValue({
      schemaVersion: 1,
      paperId: request.paperId,
      snapshotId: `paper-context-${contextHash}`,
      contextHash,
    });
    const gateway = createAgentPaperContextGateway(invoke);
    const mutable = { paperId: request.paperId, attachmentIds: [...request.attachmentIds] };
    const result = await gateway.prepare(mutable);
    mutable.attachmentIds.push("changed");
    expect(result.contextHash).toBe(contextHash);
    expect(invoke).toHaveBeenCalledWith("agent_prepare_paper_context", { request });
  });

  it("passes validated image assets without mutating caller bytes", async () => {
    const invoke = vi.fn().mockResolvedValue({ schemaVersion: 1, paperId: request.paperId, snapshotId: `paper-context-${contextHash}`, contextHash });
    const assets = [{ contextItemId: "figure-1", dataUrl: "data:image/png;base64,AAAA" }];
    await createAgentPaperContextGateway(invoke).prepare({ ...request, imageAssets: assets });
    expect(invoke).toHaveBeenCalledWith("agent_prepare_paper_context", { request: { ...request, imageAssets: assets } });
  });
});
