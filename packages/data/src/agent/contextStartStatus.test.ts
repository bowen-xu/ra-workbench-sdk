import {expect, it, vi} from "vitest";
import {createAgentContextStartGateway} from "./contextStartStatus";
const id = (n: number) => `abcdef00-1234-4678-abcd-${String(n).padStart(12, "0")}`;
const intent = {conversationId: id(1), requestId: id(2), contextSnapshotId: id(3), queue: null, resumeQueue: false};
const epoch = id(4);
const result = {schemaVersion: 1, conversationId: id(1), requestId: id(2), turnId: id(5), alreadyStarted: true, outcome: null};
const detail = {operationId: id(2), epoch, sqlFence: "0", phase: "context-start-status", sqliteCode: null, sqliteExtendedCode: null, safeCause: "context_start_worker_unconfirmed"};
it("reads the original start identity and rejects another environment or request", async () => {
  const invoke = vi.fn().mockResolvedValue({schemaVersion: 1, intent, expectedEpoch: epoch, status: {type: "unconfirmed", detail}});
  const gateway = createAgentContextStartGateway(invoke);
  expect((await gateway.read(intent, epoch)).status.type).toBe("unconfirmed");
  expect(invoke).toHaveBeenCalledWith("agent_read_context_start_status", {request: intent, expectedEpoch: epoch});
  invoke.mockResolvedValueOnce({schemaVersion: 1, intent: {...intent, contextSnapshotId: id(6)}, expectedEpoch: epoch, status: {type: "unconfirmed", detail}});
  await expect(gateway.read(intent, epoch)).rejects.toThrow();
  invoke.mockResolvedValueOnce({schemaVersion: 1, intent, expectedEpoch: id(6), status: {type: "unconfirmed", detail: {...detail, epoch: id(6)}}});
  await expect(gateway.read(intent, epoch)).rejects.toThrow();
  invoke.mockResolvedValueOnce({schemaVersion: 1, intent, expectedEpoch: epoch, status: {type: "started", result}});
  expect((await gateway.read(intent, epoch)).status).toEqual({type: "started", result});
});
it("sends a guarded start and checks the returned identity", async () => {
  const invoke = vi.fn().mockResolvedValue(result), gateway = createAgentContextStartGateway(invoke);
  expect(await gateway.start(intent, epoch)).toEqual(result);
  expect(invoke).toHaveBeenCalledWith("agent_start_context_submission_guarded", {request: intent, expectedEpoch: epoch});
  invoke.mockResolvedValueOnce({...result, requestId: id(6)});
  await expect(gateway.start(intent, epoch)).rejects.toThrow();
  await expect(gateway.start(intent, "invalid")).rejects.toThrow();
});
it("decodes an admitted queue fact without implying that execution started", async () => {
  const queued = {...intent, queue: {inputId: id(7), expectedRevision: 5}};
  const preview = {schemaVersion: 1, conversationId: id(1), requestId: id(2), turnId: id(5), contextSnapshotId: id(3), queue: queued.queue,
    input: {text: "Question", model: {providerId: "fixture", modelId: "model", revision: null}, reasoningEffort: null, context: []}};
  const invoke = vi.fn().mockResolvedValue({schemaVersion: 1, intent: queued, expectedEpoch: epoch, status: {type: "admitted", preview}});
  const gateway = createAgentContextStartGateway(invoke);
  expect((await gateway.read(queued, epoch)).status).toMatchObject({type: "admitted", preview});
  invoke.mockResolvedValueOnce({schemaVersion: 1, intent: queued, expectedEpoch: epoch, status: {type: "admitted", preview: {...preview, queue: {...queued.queue, expectedRevision: 6}}}});
  await expect(gateway.read(queued, epoch)).rejects.toThrow();
});
