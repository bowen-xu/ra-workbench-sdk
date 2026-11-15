import { expect, it, vi } from "vitest";
import { decodeAgentNoteSubmissionPreview, decodeAgentReadingNoteSubmissionPreview } from "@research-assistant/core/agent";
import { createAgentReadingNoteSubmissionGateway } from "./readingNoteSubmission";
const conversationId = "a1111111-1111-4111-8111-111111111111", requestId = "b1111111-1111-4111-8111-111111111111";
const readingNoteId = "c1111111-1111-4111-8111-111111111111", turnId = "d1111111-1111-4111-8111-111111111111", contextSnapshotId = "e1111111-1111-4111-8111-111111111111";
const receipt = {conversationId, requestId, readingNoteId};
function request() { return {conversationId, requestId, text: "Explain this note", context: {readingNoteId, expectedRevision: 3},
  model: {providerId: "deepseek", modelId: "deepseek-v4-pro", reasoningEffort: null}}; }
function preview(revision = 3) {
  const source = {anchorId: null, paperId: "retained-paper", paperTitle: "Retained paper", attachmentId: "retained-pdf", contentSha256: "a".repeat(64),
    pageIndex: 2, pageLabel: null, rects: [], quoteExact: "Retained quote", quotePrefix: "", quoteSuffix: "", selector: null, locatorVersion: 1};
  const anchor = {schemaVersion: 1, readingNoteId, noteRevision: revision, sourceAnchorId: null, paperId: source.paperId, attachmentId: source.attachmentId,
    contentSha256: source.contentSha256, pageIndex: 2, locatorVersion: 1};
  return {schemaVersion: 1, ...receipt, turnId, contextSnapshotId, input: {text: request().text, model: {providerId: "deepseek", modelId: "deepseek-v4-pro", revision: null}, reasoningEffort: null,
    context: [{kind: "note", sourceId: `reading-note:${readingNoteId}`, resourceId: readingNoteId, revision: `revision:${revision}:sha256:${"b".repeat(64)}`,
      anchor: JSON.stringify(anchor), text: JSON.stringify({schemaVersion: 1, readingNoteId, noteRevision: revision, noteType: "annotation", content: {body: "My interpretation"}, source})}]}};
}
it("prepares exact input and restores old evidence without a model start", async () => {
  const invoke = vi.fn().mockResolvedValueOnce(preview()).mockResolvedValueOnce(preview(1));
  const gateway = createAgentReadingNoteSubmissionGateway(invoke);
  expect(await gateway.prepare(request())).toEqual(preview());
  expect(await gateway.restore(receipt)).toEqual(preview(1));
  expect(invoke.mock.calls).toEqual([["agent_prepare_reading_note_submission", {request: request()}], ["agent_restore_reading_note_submission", {request: receipt}]]);
  expect(() => decodeAgentNoteSubmissionPreview(preview())).toThrow();
});
it("rejects altered source, model, message, authority and receipt identities", async () => {
  for (const change of [(v: ReturnType<typeof preview>) => {v.requestId = turnId;}, (v: ReturnType<typeof preview>) => {v.readingNoteId = turnId;},
    (v: ReturnType<typeof preview>) => {v.input.model.modelId = "different";}, (v: ReturnType<typeof preview>) => {v.input.text = "different";},
    (v: ReturnType<typeof preview>) => {v.input.context[0]!.sourceId = "note:other";}]) {
    const value = preview(); change(value);
    await expect(createAgentReadingNoteSubmissionGateway(vi.fn().mockResolvedValue(value)).prepare(request())).rejects.toThrow();
  }
  await expect(createAgentReadingNoteSubmissionGateway(vi.fn().mockResolvedValue(preview(2))).prepare(request())).rejects.toThrow();
  expect(() => decodeAgentReadingNoteSubmissionPreview({...preview(), allowDisclosure: true})).toThrow();
  expect(() => decodeAgentReadingNoteSubmissionPreview({...preview(), input: {...preview().input, instructions: ["not approved"]}})).toThrow();
});
it("captures pending request and transport parameters independently", async () => {
  let resolve!: (value: unknown) => void;
  const invoke = vi.fn((_command, args) => {args.request.context.expectedRevision = 99; args.request.model.modelId = "transport mutation";
    return new Promise(done => {resolve = done;});});
  const mutable = request(), pending = createAgentReadingNoteSubmissionGateway(invoke).prepare(mutable);
  mutable.context.expectedRevision = 10; mutable.model.modelId = "caller mutation";
  resolve(preview()); expect(await pending).toEqual(preview());
});
it("rejects bad requests before IPC, permits absent optional model and never automatically retries a failed read", async () => {
  const invoke = vi.fn().mockRejectedValue(new Error("unavailable")), gateway = createAgentReadingNoteSubmissionGateway(invoke);
  await expect(gateway.prepare({...request(), context: {readingNoteId, expectedRevision: -1}})).rejects.toThrow();
  await expect(gateway.restore({...receipt, readingNoteId: "not-a-uuid"})).rejects.toThrow();
  expect(invoke).not.toHaveBeenCalled();
  await expect(gateway.restore(receipt)).rejects.toThrow("unavailable"); expect(invoke).toHaveBeenCalledOnce();
  const noModel = {conversationId, requestId, text: request().text, context: request().context};
  const allowed = vi.fn().mockResolvedValue(preview());
  await expect(createAgentReadingNoteSubmissionGateway(allowed).prepare(noModel)).resolves.toEqual(preview());
  expect(allowed).toHaveBeenCalledWith("agent_prepare_reading_note_submission", {request: {...noModel, model: null}});
});

it("starts only the exact confirmed reading snapshot and preserves durable duplicate outcomes", async () => {
  const response = {schemaVersion: 1, conversationId, requestId, turnId, alreadyStarted: true, outcome: "canceled"};
  const invoke = vi.fn().mockResolvedValue(response), gateway = createAgentReadingNoteSubmissionGateway(invoke);
  const original = decodeAgentReadingNoteSubmissionPreview(preview());
  expect(await gateway.start(original, "deepSeekNonThinking")).toEqual(response);
  expect(invoke).toHaveBeenCalledExactlyOnceWith("agent_start_reading_note_submission", {request: {
    conversationId, requestId, readingNoteId, contextSnapshotId, model: original.input.model, mode: "deepSeekNonThinking",
  }});
});
it("rejects invalid confirmation mode and wrong start identity without retrying unknown outcomes", async () => {
  const invoke = vi.fn(), gateway = createAgentReadingNoteSubmissionGateway(invoke), original = decodeAgentReadingNoteSubmissionPreview(preview());
  await expect(gateway.start(original, "invented" as never)).rejects.toThrow(); expect(invoke).not.toHaveBeenCalled();
  for (const patch of [{conversationId: turnId}, {requestId: turnId}, {turnId: conversationId}]) {
    invoke.mockResolvedValue({schemaVersion: 1, conversationId, requestId, turnId, alreadyStarted: false, outcome: null, ...patch});
    await expect(gateway.start(original, "deepSeekNonThinking")).rejects.toThrow();
  }
  invoke.mockClear().mockRejectedValue(new Error("unknown outcome"));
  await expect(gateway.start(original, "deepSeekNonThinking")).rejects.toThrow("unknown outcome");
  expect(invoke).toHaveBeenCalledOnce();
});

function withProfile() {
  const value = preview();
  const scope = `reading-note:${readingNoteId}`, source = "agent/config.toml#profiles.reading_note", revision = "a".repeat(64);
  return {...value,input:{...value.input,
    instructions:[{environmentId:scope,scopeId:scope,sourceId:source,revision,originalBytes:7,text:"界A",disposition:"truncated"}],
    instructionConfigs:[{environment_id:scope,layers:[{origin:{tier:"user",source_id:source,revision},instructions:{max_bytes:4,fallback_filenames:null}}]}],
  }};
}
it("preserves the native scoped profile, budget and frozen text",()=>{
  const value = withProfile();
  expect(decodeAgentReadingNoteSubmissionPreview(value).input).toEqual(value.input);
});
it("rejects mismatched profile scope, config version and extra grants",()=>{
  const mutations = [
    (v:ReturnType<typeof withProfile>)=>{v.input.instructions[0]!.scopeId="another-note";},
    (v:ReturnType<typeof withProfile>)=>{v.input.instructions[0]!.sourceId="AGENTS.md";},
    (v:ReturnType<typeof withProfile>)=>{v.input.instructionConfigs[0]!.layers[0]!.origin.revision="b".repeat(64);},
    (v:ReturnType<typeof withProfile>)=>{v.input.instructionConfigs[0]!.layers[0]!.instructions.max_bytes=3;},
    (v:ReturnType<typeof withProfile>)=>{v.input.instructionConfigs=[];},
    (v:ReturnType<typeof withProfile>)=>{v.input.instructionConfigs[0]!.layers[0]!.origin.tier="workspace";},
  ];
  for(const mutate of mutations){const value=withProfile();mutate(value);expect(()=>decodeAgentReadingNoteSubmissionPreview(value)).toThrow();}
});
