import { describe, expect, it } from "vitest";
import {
  decodeAgentPaperSubmissionPrepareRequest,
  decodeAgentPaperSubmissionPreview,
  decodeAgentPaperSteerRequest,
  decodeAgentPaperTurnSourcesResponse,
} from "./paperSubmission";

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
        anchor: JSON.stringify({
          paperId,
          snapshotId,
          attachmentId: "attachment-1",
          parseRunId: "parse-1",
          kind: "text",
          rawRef: "block-1",
          pageIndex: 0,
        }),
        text: "Frozen paper text",
      }],
    },
  };
}

describe("paper submission contract", () => {
  it("preserves application skills and rejects foreign skill scopes", () => {
    const value = preview();
    const skill = { descriptor: {
      identity: { environment_id: "application", source_id: ".agents/skills/review/SKILL.md", revision: "a".repeat(64) },
      name: "review", description: "Review prose", allow_implicit_invocation: false,
    }, explicit: true };
    const response = { ...value, input: { ...value.input, skills: [skill] } };
    expect(decodeAgentPaperSubmissionPreview(response).input.skills).toEqual([skill]);
    skill.descriptor.identity.environment_id = "manuscript:other";
    expect(() => decodeAgentPaperSubmissionPreview(response)).toThrow();
    skill.descriptor.identity.environment_id = "application";
    skill.descriptor.identity.source_id = ".agents/skills-other/review/SKILL.md";
    expect(() => decodeAgentPaperSubmissionPreview(response)).toThrow();
  });
  it("accepts a frozen paper request and preview", () => {
    expect(decodeAgentPaperSubmissionPrepareRequest({
      conversationId,
      requestId,
      paperId,
      paperContextSnapshotId: snapshotId,
      expectedContextHash: "a".repeat(64),
      text: "Explain the contribution",
    }).paperId).toBe(paperId);
    expect(decodeAgentPaperSubmissionPreview(preview()).input.context).toHaveLength(1);
  });

  it("accepts a native preview whose paper evidence consists only of images", () => {
    const value = preview();
    expect(decodeAgentPaperSubmissionPreview({ ...value, input: { ...value.input, context: [] } }).input.context).toEqual([]);
  });

  it("preserves optional session and turn configuration overrides", () => {
    const request = decodeAgentPaperSubmissionPrepareRequest({
      conversationId,
      requestId,
      paperId,
      paperContextSnapshotId: snapshotId,
      expectedContextHash: "a".repeat(64),
      text: "Explain the contribution",
      sessionConfig: { maxBytes: 6 },
      turnConfig: { fallbackFilenames: [] },
    });
    expect(request.sessionConfig).toEqual({ maxBytes: 6, fallbackFilenames: null });
    expect(request.turnConfig).toEqual({ maxBytes: null, fallbackFilenames: [] });
    expect(() => decodeAgentPaperSubmissionPrepareRequest({
      conversationId,
      requestId,
      paperId,
      paperContextSnapshotId: snapshotId,
      expectedContextHash: "a".repeat(64),
      text: "Explain the contribution",
      sessionConfig: { fallbackFilenames: ["../unsafe.toml"] },
    })).toThrow();
  });

  it("accepts an explicitly selected retrieval trace without treating it as paper evidence", () => {
    const request = decodeAgentPaperSubmissionPrepareRequest({
      conversationId,
      requestId,
      paperId,
      paperContextSnapshotId: snapshotId,
      expectedContextHash: "a".repeat(64),
      retrieval: { traceId: "trace-1", query: "autonomy" },
      text: "Compare the retrieved concepts",
    });
    expect(request.retrieval).toEqual({ traceId: "trace-1", query: "autonomy" });
    const value = preview();
    value.input.context.push({
      sourceId: "retrieval:trace-1",
      kind: "retrieval",
      resourceId: paperId,
      revision: "trace:trace-1",
      anchor: JSON.stringify({ paperId, snapshotId, traceId: "trace-1", query: "autonomy" }),
      text: "[CN-S1] Retrieved source",
    });
    expect(decodeAgentPaperSubmissionPreview(value).input.context).toHaveLength(2);
  });

  it("rejects cross-paper, cross-snapshot and non-paper evidence", () => {
    const badPaper = preview();
    badPaper.input.context[0]!.resourceId = "another-paper";
    expect(() => decodeAgentPaperSubmissionPreview(badPaper)).toThrow();

    const badSnapshot = preview();
    badSnapshot.input.context[0]!.anchor = JSON.stringify({
      paperId,
      snapshotId: "another-snapshot",
      attachmentId: "attachment-1",
      parseRunId: "parse-1",
      kind: "text",
      rawRef: "block-1",
      pageIndex: 0,
    });
    expect(() => decodeAgentPaperSubmissionPreview(badSnapshot)).toThrow();

    const badKind = preview();
    badKind.input.context[0]!.kind = "manuscript";
    expect(() => decodeAgentPaperSubmissionPreview(badKind)).toThrow();
  });

  it("validates same-turn paper steering identities", () => {
    expect(decodeAgentPaperSteerRequest({ conversationId, paperId, turnId, inputId: requestId, text: "More detail" }).paperId).toBe(paperId);
    expect(() => decodeAgentPaperSteerRequest({ conversationId, paperId, turnId, inputId: requestId, text: "" })).toThrow();
  });

  it("accepts source geometry only when it remains bound to the requested turn", () => {
    const response = decodeAgentPaperTurnSourcesResponse({
      schemaVersion: 1, conversationId, paperId, turnId,
      retrievalTraceId: "trace-1",
      sources: [{ sourceId: `paper-source:${"a".repeat(64)}`, id: "P1-T1", attachmentId: "attachment-1", regions: [{ pageIndex: 2, rect: { x: .1, y: .2, width: .3, height: .1 } }] }],
    }, { conversationId, paperId, turnId });
    expect(response.sources[0]?.regions[0]?.pageIndex).toBe(2);
    expect(response.retrievalTraceId).toBe("trace-1");
    expect(() => decodeAgentPaperTurnSourcesResponse({
      schemaVersion: 1, conversationId, paperId: "other", turnId, sources: [],
    }, { conversationId, paperId, turnId })).toThrow();
  });
});
