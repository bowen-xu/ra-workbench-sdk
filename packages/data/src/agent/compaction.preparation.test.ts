import { describe, expect, it, vi } from "vitest";
import {
  agentWritingCompactionStartRequest, decodeAgentWritingCompactionPrepareRequest, type AgentWritingCompactionPreview,
  type AgentWritingCompactionPrepareRequest, type AgentWritingReceipt,
} from "@research-assistant/core/agent";
import { createAgentCompactionGateway } from "./compaction";

const id = (value: number): string => `00000000-0000-0000-0000-${value.toString(16).padStart(12, "0")}`;
const receipt: AgentWritingReceipt = { conversationId: id(1), requestId: id(2), manuscriptId: id(3) };
function request(): AgentWritingCompactionPrepareRequest {
  return { expectedRevision: 12, request: { conversationId: receipt.conversationId, requestId: receipt.requestId,
    text: "/compact", context: { manuscriptId: receipt.manuscriptId, files: [] } } };
}
function prepared(): AgentWritingCompactionPreview {
  return { expectedRevision: 12, preview: { schemaVersion: 1, ...receipt, turnId: id(4), contextSnapshotId: id(5),
    input: { text: "/compact", model: { providerId: "native-default", modelId: "resolved-model", revision: "frozen-revision" },
      reasoningEffort: null, context: [{ sourceId: "manuscript:source", kind: "manuscript", resourceId: receipt.manuscriptId,
        revision: "file-revision", anchor: JSON.stringify({ manuscriptId: receipt.manuscriptId }), text: "Synthetic frozen source" }],
      instructions: [], skills: [], userInput: [] } } };
}

describe("writing compaction frozen-history preparation", () => {
  it("uses the dedicated prepare/restore endpoints and retains the exact frozen result", async () => {
    const invoke = vi.fn(async () => prepared());
    const gateway = createAgentCompactionGateway(invoke);
    expect(await gateway.prepareWriting(request())).toEqual(prepared());
    expect(await gateway.restoreWriting(receipt)).toEqual(prepared());
    expect(invoke.mock.calls).toEqual([
      ["agent_prepare_writing_compaction", decodeAgentWritingCompactionPrepareRequest(request())],
      ["agent_restore_writing_compaction", { request: receipt }],
    ]);
    const start = agentWritingCompactionStartRequest(prepared());
    expect(start).toMatchObject({ expectedRevision: 12, contextSnapshotId: id(5), model: prepared().preview.input.model });
  });

  it("allows absent and None model selections to resolve natively", async () => {
    for (const selection of [undefined, null]) {
      const value = request();
      const response = await createAgentCompactionGateway(async () => prepared()).prepareWriting({ ...value, request: { ...value.request, model: selection } });
      expect(response.preview.input.model).toEqual(prepared().preview.input.model);
    }
  });

  it("checks only the model identity actually selected by the caller", async () => {
    const value = request();
    const model = { providerId: "native-default", modelId: "resolved-model" };
    const gateway = createAgentCompactionGateway(async () => prepared());
    expect(await gateway.prepareWriting({ ...value, request: { ...value.request, model } })).toEqual(prepared());
    for (const changed of [{ ...model, providerId: "other" }, { ...model, modelId: "other" }]) {
      await expect(gateway.prepareWriting({ ...value, request: { ...value.request, model: changed } })).rejects.toThrow();
    }
  });

  it("rejects mismatched C/R/manuscript/history and malformed frozen snapshot or model", async () => {
    for (const field of ["conversationId", "requestId", "manuscriptId"] as const) {
      const saved = { ...prepared(), preview: { ...prepared().preview, [field]: id(99) } };
      const gateway = createAgentCompactionGateway(async () => saved);
      await expect(gateway.prepareWriting(request())).rejects.toThrow();
      await expect(gateway.restoreWriting(receipt)).rejects.toThrow();
    }
    const changed = { ...prepared(), expectedRevision: 13 };
    await expect(createAgentCompactionGateway(async () => changed).prepareWriting(request())).rejects.toThrow();
    // Restore has no renderer-supplied W to compare; it returns native's frozen W.
    expect((await createAgentCompactionGateway(async () => changed).restoreWriting(receipt)).expectedRevision).toBe(13);
    for (const preview of [
      { ...prepared().preview, contextSnapshotId: "malformed" },
      { ...prepared().preview, input: { ...prepared().preview.input, model: { providerId: "native-default", modelId: 42, revision: null } } },
      { ...prepared().preview, input: { ...prepared().preview.input, text: "ordinary submission" } },
    ]) {
      await expect(createAgentCompactionGateway(async () => ({ ...prepared(), preview })).prepareWriting(request())).rejects.toThrow();
    }
  });

  it("freezes preparation before I/O and preserves native errors without adding current history", async () => {
    let finish!: (result: unknown) => void;
    const invoke = vi.fn(() => new Promise<unknown>(resolve => { finish = resolve; }));
    const value = { ...request(), request: { ...request().request } };
    const expected = decodeAgentWritingCompactionPrepareRequest(request());
    const pending = createAgentCompactionGateway(invoke).prepareWriting(value);
    value.expectedRevision = 99;
    value.request.text = "later edit";
    finish(prepared());
    expect(await pending).toEqual(prepared());
    expect(invoke).toHaveBeenCalledExactlyOnceWith("agent_prepare_writing_compaction", expected);
    const conflict = { code: "conflict" };
    await expect(createAgentCompactionGateway(async () => { throw conflict; }).prepareWriting(request())).rejects.toBe(conflict);
  });

  it("rejects unsafe history and unsafe existing instruction overrides before native I/O", async () => {
    const invoke = vi.fn(async () => prepared());
    const gateway = createAgentCompactionGateway(invoke);
    await expect(gateway.prepareWriting({ ...request(), expectedRevision: Number.MAX_SAFE_INTEGER + 1 })).rejects.toThrow();
    const value = request();
    await expect(gateway.prepareWriting({ ...value, request: { ...value.request, sessionConfig: { fallbackFilenames: ["../AGENTS.md"] } } })).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });
});
