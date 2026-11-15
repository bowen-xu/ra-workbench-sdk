import {expect, it, vi} from "vitest";
import {decodeAgentWritingQueuePreviewRequest} from "@research-assistant/core/agent";
import {createAgentInputQueuePreviewGateway} from "./inputQueuePreview";
const id = (n: number) => `abcdef00-1234-5678-abcd-${String(n).padStart(12, "0")}`;
const intent = {inputId: id(1), expectedRevision: 1, submission: {conversationId: id(2), requestId: id(3), text: "original", context: {manuscriptId: id(4), files: []}}};
const result = {schemaVersion: 1, inputId: id(1), preview: {schemaVersion: 1, conversationId: id(2), requestId: id(3), manuscriptId: id(4), turnId: id(5), contextSnapshotId: id(6),
  input: {text: "original", model: {providerId: "provider", modelId: "model", revision: null}, reasoningEffort: null, context: []}}, queue: {
  schemaVersion: 1, conversationId: id(2), manuscriptId: id(4), revision: 2, paused: false, preparingInputId: id(1), inputs: [{inputId: id(1), text: "original"}]}};
it("normalizes and freezes full preparation before dispatch and status uses a distinct readonly RPC", async () => {
  const invoke = vi.fn(async (command: string) => command === "agent_prepare_writing_queue_preview" ? result : {schemaVersion: 1, intent, status: {type: "notFound"}});
  const gateway = createAgentInputQueuePreviewGateway(invoke), input = structuredClone(intent), expected = decodeAgentWritingQueuePreviewRequest(intent);
  const work = gateway.prepare(input); input.submission.text = "changed caller"; await work; await gateway.prepareStatus(intent);
  expect(invoke.mock.calls).toEqual([["agent_prepare_writing_queue_preview", {request: expected}], ["agent_read_writing_queue_preview_prepare_status", {request: expected}]]);
});
it("rejects internally valid status for a different complete intent", async () => {
  for (const submission of [{...intent.submission, text: "changed"}, {...intent.submission, resources: [{kind: "structuredObject", resourceId: "object", access: "readOnly"}]},
    {...intent.submission, turnConfig: {maxBytes: 8}}, {...intent.submission, model: {providerId: "p", modelId: "m"}}]) {
    const gateway = createAgentInputQueuePreviewGateway(async () => ({schemaVersion: 1, intent: {...intent, submission}, status: {type: "notFound"}}));
    await expect(gateway.prepareStatus(intent)).rejects.toThrow();
  }
});
it("propagates safe SQL failure without automatic replay or source preparation", async () => {
  const cause = {code: "storage", reason: {conversationId: id(2), manuscriptId: id(4), inputId: id(1), previewRequestId: id(3), operationId: id(3), code: "DATA_SQL_COMMIT_UNKNOWN", reason: {safeCause: "sql_commit_outcome_unknown"}}};
  const invoke = vi.fn(async () => {throw cause;}), gateway = createAgentInputQueuePreviewGateway(invoke);
  await expect(gateway.prepare(intent)).rejects.toBe(cause); await expect(gateway.prepareStatus(intent)).rejects.toBe(cause);
  expect(invoke).toHaveBeenCalledTimes(2);
});
