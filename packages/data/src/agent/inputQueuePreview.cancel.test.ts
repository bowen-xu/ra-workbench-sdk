import { expect, it, vi } from "vitest";
import { createAgentInputQueuePreviewGateway } from "./inputQueuePreview";

const id = (n: number) => `abcdef00-1234-5678-abcd-${String(n).padStart(12, "0")}`;
const intent = {conversationId: id(1), manuscriptId: id(2), requestId: id(3), expectedRevision: 8, inputId: id(4), previewRequestId: id(5)};
const queue = {schemaVersion: 1, conversationId: id(1), manuscriptId: id(2), revision: 9,
  paused: true, preparingInputId: null, inputs: [{inputId: id(4), text: "original input"}]};
const proof = {schemaVersion: 1, operationId: id(3), conversationId: id(1), family: "agent.queue.preview.cancel",
  epoch: id(6), sqlFence: "9007199254740993", replayed: true, result: null};

it("separates cancellation from read-only status and never starts or retries a task", async () => {
  const response = {schemaVersion: 1, intent, status: {type: "committed", proof, queue}};
  const invoke = vi.fn(async (command: string) => command === "agent_cancel_writing_queue_preview" ? queue : response);
  const gateway = createAgentInputQueuePreviewGateway(invoke);
  expect(await gateway.cancel(intent)).toEqual(queue);
  expect(await gateway.cancelStatus(intent)).toEqual(response);
  expect(invoke.mock.calls).toEqual([
    ["agent_cancel_writing_queue_preview", {request: intent}],
    ["agent_read_writing_queue_preview_cancel_status", {request: intent}],
  ]);
});

it("rejects status for a different frozen intent even when its own proof is internally consistent", async () => {
  for (const patch of [{conversationId: id(91)}, {manuscriptId: id(92)}, {requestId: id(93)},
    {expectedRevision: 9}, {inputId: id(94)}, {previewRequestId: id(95)}]) {
    const response = {schemaVersion: 1, intent: {...intent, ...patch}, status: {type: "notFound"}};
    await expect(createAgentInputQueuePreviewGateway(async () => response).cancelStatus(intent)).rejects.toThrow();
  }
});

it("freezes the original operation before transport and preserves unknown failures without implicit retry", async () => {
  let finish!: (value: unknown) => void;
  const invoke = vi.fn(() => new Promise<unknown>(resolve => { finish = resolve; }));
  const input = {...intent}, expected = structuredClone(intent);
  const pending = createAgentInputQueuePreviewGateway(invoke).cancel(input);
  input.expectedRevision = 99; input.previewRequestId = id(99);
  finish(queue);
  expect(await pending).toEqual(queue);
  expect(invoke).toHaveBeenCalledExactlyOnceWith("agent_cancel_writing_queue_preview", {request: expected});
  const cause = {code: "storage", reason: {code: "DATA_SQL_COMMIT_UNKNOWN", reason: {operationId: id(3), safeCause: "sql_commit_outcome_unknown"}}};
  const unavailable = vi.fn(async () => { throw cause; });
  const gateway = createAgentInputQueuePreviewGateway(unavailable);
  await expect(gateway.cancel(intent)).rejects.toBe(cause);
  expect(unavailable).toHaveBeenCalledTimes(1);
  await expect(gateway.cancelStatus(intent)).rejects.toBe(cause);
  expect(unavailable).toHaveBeenCalledTimes(2);
});
