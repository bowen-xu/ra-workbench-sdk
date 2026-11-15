import { describe, expect, it } from "vitest";
import { AgentCompactionDecodeError, agentWritingCompactionStartRequest, decodeAgentCompactionStartRequest,
  decodeAgentWritingCompactionPreview, type AgentCompactionHost, type AgentWritingCompactionPreview } from "./compaction";

const id = "abcdef01-2345-6789-abcd-ef0123456789";
const nil = "00000000-0000-0000-0000-000000000000";
function request(host: AgentCompactionHost = { kind: "manuscript", manuscriptId: id }) {
  return { conversationId: id, requestId: id, contextSnapshotId: id, expectedRevision: 0,
    model: { providerId: "unreviewed-provider", modelId: "future/model", revision: null }, host };
}
function prepared(): AgentWritingCompactionPreview {
  return { expectedRevision: 7, preview: { schemaVersion: 1, conversationId: id, requestId: id,
    manuscriptId: id, contextSnapshotId: "00000000-0000-0000-0000-000000000002", turnId: "00000000-0000-0000-0000-000000000003",
    input: { text: " /compact ", model: { providerId: "resolved-provider", modelId: "resolved-model", revision: "frozen-revision" },
      reasoningEffort: null, context: [], instructions: [], skills: [], userInput: [] } } };
}

describe("native compaction admission contract", () => {
  it("retains each native host's exact fields without interpreting paper identities", () => {
    for (const host of [
      { kind: "manuscript", manuscriptId: id },
      { kind: "paper", paperId: "local-paper:synthetic", paperContextSnapshotId: "source-revision:7" },
      { kind: "note", pageId: id },
      { kind: "readingNote", readingNoteId: id },
    ] satisfies AgentCompactionHost[]) {
      expect(decodeAgentCompactionStartRequest(request(host))).toEqual(request(host));
    }
  });
  it("matches native UUID forms and rejects nil command identities", () => {
    for (const spelling of [id.toUpperCase(), id.replaceAll("-", ""), `{${id}}`, `urn:uuid:${id}`]) {
      expect(decodeAgentCompactionStartRequest({ ...request(), conversationId: spelling, requestId: spelling, contextSnapshotId: spelling,
        host: { kind: "note", pageId: spelling } })).toMatchObject({ conversationId: id, requestId: id, contextSnapshotId: id, host: { pageId: id } });
    }
    for (const field of ["conversationId", "requestId", "contextSnapshotId"]) {
      expect(() => decodeAgentCompactionStartRequest({ ...request(), [field]: nil })).toThrow(AgentCompactionDecodeError);
    }
    // Host existence/availability is checked by the native restore use case.
    expect(decodeAgentCompactionStartRequest(request({ kind: "note", pageId: nil })).host).toEqual({ kind: "note", pageId: nil });
  });
  it("does not infer model policy, trim identities or require a revision", () => {
    const value = { ...request(), model: { providerId: " any provider ", modelId: "", extension: "native serde ignores this" } };
    expect(decodeAgentCompactionStartRequest(value).model).toEqual({ providerId: " any provider ", modelId: "", revision: null });
    expect(decodeAgentCompactionStartRequest({ ...request(), model: { ...value.model, revision: " exact revision " } }).model.revision).toBe(" exact revision ");
    expect(() => decodeAgentCompactionStartRequest({ ...request(), model: { ...value.model, revision: 1 } })).toThrow(AgentCompactionDecodeError);
  });
  it("preserves the confirmed safe history boundary and never accepts renderer policy", () => {
    expect(decodeAgentCompactionStartRequest({ ...request(), expectedRevision: Number.MAX_SAFE_INTEGER }).expectedRevision).toBe(Number.MAX_SAFE_INTEGER);
    for (const expectedRevision of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, Infinity, "1", null]) {
      expect(() => decodeAgentCompactionStartRequest({ ...request(), expectedRevision })).toThrow(AgentCompactionDecodeError);
    }
    for (const field of ["systemInstructions", "strategy", "tools", "threshold", "turnId"]) {
      expect(() => decodeAgentCompactionStartRequest({ ...request(), [field]: "renderer policy" })).toThrow(AgentCompactionDecodeError);
    }
    expect(() => decodeAgentCompactionStartRequest({ ...request(), host: { ...request().host, extra: true } })).toThrow(AgentCompactionDecodeError);
  });
  it("decodes the frozen preparation without dropping submission fields", () => {
    expect(decodeAgentWritingCompactionPreview(prepared())).toEqual(prepared());
    for (const expectedRevision of [-1, Number.MAX_SAFE_INTEGER + 1, "7", null]) {
      expect(() => decodeAgentWritingCompactionPreview({ ...prepared(), expectedRevision })).toThrow();
    }
    expect(() => decodeAgentWritingCompactionPreview({ ...prepared(), windowId: id })).toThrow();
  });
  it("builds confirmation only from the returned snapshot, model and frozen history", () => {
    const saved = prepared();
    const start = agentWritingCompactionStartRequest(saved);
    expect(start).toEqual({ conversationId: id, requestId: id, contextSnapshotId: saved.preview.contextSnapshotId,
      expectedRevision: 7, model: saved.preview.input.model, host: { kind: "manuscript", manuscriptId: id } });
    expect(start).not.toHaveProperty("turnId");
    expect(start).not.toHaveProperty("windowId");
    expect(() => agentWritingCompactionStartRequest({ ...saved, preview: { ...saved.preview, input: { ...saved.preview.input, text: "ordinary input" } } })).toThrow(AgentCompactionDecodeError);
  });
});
