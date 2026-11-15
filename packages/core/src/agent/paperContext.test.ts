import { describe, expect, it } from "vitest";
import {
  decodeAgentPaperContextPrepareRequest,
  decodeAgentPaperContextPreparation,
} from "./paperContext";

const request = { paperId: "paper-42", attachmentIds: ["attachment-1"] };

describe("paper context preparation contract", () => {
  it("accepts a bounded attachment selection and matching snapshot identity", () => {
    const frozen = decodeAgentPaperContextPrepareRequest(request);
    const contextHash = "a".repeat(64);
    expect(decodeAgentPaperContextPreparation({
      schemaVersion: 1,
      paperId: request.paperId,
      snapshotId: `paper-context-${contextHash}`,
      contextHash,
    }, frozen).snapshotId).toBe(`paper-context-${contextHash}`);
  });

  it("rejects duplicate attachments and mismatched paper snapshots", () => {
    expect(() => decodeAgentPaperContextPrepareRequest({ paperId: request.paperId, attachmentIds: ["attachment-1", "attachment-1"] })).toThrow();
    expect(() => decodeAgentPaperContextPreparation({
      schemaVersion: 1,
      paperId: "another-paper",
      snapshotId: `paper-context-${"a".repeat(64)}`,
      contextHash: "a".repeat(64),
    }, request)).toThrow();
  });

  it("bounds optional PNG image assets", () => {
    const frozen = decodeAgentPaperContextPrepareRequest({ ...request, imageAssets: [{ contextItemId: "figure-1", dataUrl: "data:image/png;base64,AAAA" }] });
    expect(frozen.imageAssets?.[0]?.contextItemId).toBe("figure-1");
    expect(() => decodeAgentPaperContextPrepareRequest({ ...request, imageAssets: [{ contextItemId: "figure-1", dataUrl: "data:image/jpeg;base64,AAAA" }] })).toThrow();
  });
});
