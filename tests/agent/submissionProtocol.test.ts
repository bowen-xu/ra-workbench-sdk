import { expect, it, vi } from "vitest";
import { decodeAgentSubmissionPreview, decodeAgentWritingPrepareRequest, decodeAgentWritingStartResponse } from "../../packages/core/src/agent";
import { createAgentSubmissionGateway } from "../../packages/data/src/agent";
const id = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
it("admits an explicit start without mistaking its acknowledgement for completion", async () => {
  const response = { schemaVersion: 1, conversationId: id, requestId: id, turnId: other, alreadyStarted: false, outcome: null };
  const request = { conversationId: id, requestId: id, manuscriptId: id, contextSnapshotId: id,
    model: { providerId: "deepseek", modelId: "deepseek-v4-pro", revision: null }, mode: "deepSeekNonThinking" as const };
  const invoke = vi.fn(async () => response);
  await expect(createAgentSubmissionGateway(invoke).startWriting(request)).resolves.toEqual(response);
  expect(invoke).toHaveBeenCalledWith("agent_start_writing_submission", { request });
  expect(() => decodeAgentWritingStartResponse({ ...response, outcome: "completed" })).toThrow();
  expect(decodeAgentWritingStartResponse({ ...response, alreadyStarted: true, outcome: "completed" }).outcome).toBe("completed");
  await expect(createAgentSubmissionGateway(async () => ({ ...response, requestId: other })).startWriting(request)).rejects.toThrow();
});
function preview() {
  return {
    schemaVersion: 1, conversationId: id, requestId: id, manuscriptId: id, turnId: id, contextSnapshotId: id,
    input: { text: "Explain", model: { providerId: "fixture", modelId: "fixture", revision: null }, reasoningEffort: null,
      context: [{ sourceId: "source", kind: "manuscript", resourceId: "main.tex", revision: "hash", anchor: JSON.stringify({ manuscriptId: id }), text: "原文😀" }] },
  };
}

it("bounds structured anchors separately from short source identifiers",()=>{
  const decode=(anchor:string)=>decodeAgentSubmissionPreview({...preview(),input:{...preview().input,context:[{...preview().input.context[0],anchor}]}});
  expect(decode("a".repeat(2048)).input.context[0]?.anchor?.length).toBe(2048);
  expect(()=>decode("a".repeat(65537))).toThrow();
  expect(()=>decode("bad\0anchor")).toThrow();
  expect(()=>decodeAgentSubmissionPreview({...preview(),input:{...preview().input,context:[{...preview().input.context[0],sourceId:"s".repeat(1025)}]}})).toThrow();
});
it("decodes frozen input and rejects unknown fields, invalid identities, kinds and duplicate sources", () => {
  expect(decodeAgentSubmissionPreview(preview())).toEqual(preview());
  for (const patch of [{ schemaVersion: 2 }, { requestId: "bad" }, { credentials: "secret" }, { input: { ...preview().input, images: [] } }]) {
    expect(() => decodeAgentSubmissionPreview({ ...preview(), ...patch })).toThrow();
  }
  for (const context of [[{ ...preview().input.context[0], kind: "image" }], [preview().input.context[0], preview().input.context[0]]]) {
    expect(() => decodeAgentSubmissionPreview({ ...preview(), input: { ...preview().input, context } })).toThrow();
  }
});
it("uses UTF-8 limits and rejects malformed Unicode rather than silently replacing it", () => {
  for (const text of ["😀".repeat(262145), "\ud800", " "]) {
    expect(() => decodeAgentSubmissionPreview({ ...preview(), input: { ...preview().input, text } })).toThrow();
  }
});
it("prepares and restores without invoking model start, and rejects crossed receipts or source scopes", async () => {
  const invoke = vi.fn(async () => preview());
  const gateway = createAgentSubmissionGateway(invoke);
  const receipt = { conversationId: id, requestId: id, manuscriptId: id };
  await expect(gateway.restoreWriting(receipt)).resolves.toEqual(preview());
  expect(invoke).toHaveBeenLastCalledWith("agent_restore_writing_submission", { request: receipt });
  const request = { conversationId: id, requestId: id, text: "Explain", context: { manuscriptId: id, files: [{ relativePath: "main.tex", expectedDiskSha256: "hash" }] } };
  await expect(gateway.prepareWriting(request)).resolves.toEqual(preview());
  expect(invoke).toHaveBeenLastCalledWith("agent_prepare_writing_submission", { request: decodeAgentWritingPrepareRequest(request) });
  expect(invoke).toHaveBeenCalledTimes(2);
  for (const key of ["conversationId", "requestId", "manuscriptId"]) {
    const wrong = createAgentSubmissionGateway(async () => ({ ...preview(), [key]: other }));
    await expect(wrong.restoreWriting(receipt)).rejects.toThrow();
  }
  const wrongSource = preview();
  wrongSource.input.context[0].anchor = JSON.stringify({ manuscriptId: other });
  await expect(createAgentSubmissionGateway(async () => wrongSource).restoreWriting(receipt)).rejects.toThrow();
});

it("preserves instruction provenance and rejects malformed or over-budget snapshots", () => {
  const entry = { environmentId: "paper", scopeId: ".", sourceId: "AGENTS.md", revision: "v1", originalBytes: 6, text: "中文", disposition: "included" };
  const withInstructions = (instructions: unknown) => ({ ...preview(), input: { ...preview().input, instructions } });
  expect(decodeAgentSubmissionPreview(withInstructions([entry])).input.instructions).toEqual([entry]);
  for (const instructions of [null, [entry, entry], [{ ...entry, originalBytes: 2 }], [{ ...entry, grant: true }], [{ ...entry, disposition: "budgetExcluded" }], [{ ...entry, text: "a".repeat(1_048_577), originalBytes: 1_048_577 }]]) {
    expect(() => decodeAgentSubmissionPreview(withInstructions(instructions))).toThrow();
  }
  const omitted = { ...entry, text: "", disposition: "budgetExcluded" };
  expect(decodeAgentSubmissionPreview(withInstructions([omitted])).input.instructions).toEqual([omitted]);
});

it("keeps frozen configuration layers and rejects authority, invalid order and duplicates", () => {
  const config = { environment_id: "manuscript:fixture", layers: [{
    origin: { tier: "workspace", source_id: ".research-assistant/agent.toml", revision: "sha256" },
    instructions: { max_bytes: 0, fallback_filenames: ["RULES.md"] },
  }] };
  const decode = (instructionConfigs: unknown) => decodeAgentSubmissionPreview({ ...preview(), input: { ...preview().input, instructionConfigs } });
  expect(decode([config]).input.instructionConfigs).toEqual([config]);
  expect(() => decode([config, config])).toThrow();
  expect(() => decode([{ ...config, layers: [config.layers[0], { ...config.layers[0], origin: { ...config.layers[0].origin, tier: "user" } }] }])).toThrow();
  expect(() => decode([{ ...config, layers: [{ ...config.layers[0], instructions: { ...config.layers[0].instructions, granted: true } }] }])).toThrow();
  expect(() => decode([{ ...config, layers: [{ ...config.layers[0], instructions: { max_bytes: 1048577, fallback_filenames: null } }] }])).toThrow();
});
