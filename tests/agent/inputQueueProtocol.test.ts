import { expect, it, vi } from "vitest";
import { decodeAgentWritingQueueResponse, decodeAgentWritingQueueEditRequest } from "../../packages/core/src/agent";
import { createAgentInputQueueGateway } from "../../packages/data/src/agent";
const id = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const scope = { conversationId: id, manuscriptId: other };
const request = { ...scope, requestId: id, expectedRevision: 0, edit: { type: "add" as const, inputId: id, text: "保留 🧬\n" } };
const response = { schemaVersion: 1, ...scope, revision: 1, paused: false, preparingInputId: null, inputs: [{ inputId: id, text: request.edit.text }] };

it("routes scoped reads and exact edits with stable request IDs", async () => {
  const invoke = vi.fn().mockResolvedValue(response);
  const gateway = createAgentInputQueueGateway(invoke);
  expect(await gateway.read(scope)).toEqual(response);
  expect(invoke).toHaveBeenLastCalledWith("agent_read_writing_input_queue", { request: scope });
  expect(await gateway.edit(request)).toEqual(response);
  expect(invoke).toHaveBeenLastCalledWith("agent_edit_writing_input_queue", { request });
});
it("rejects wrong scope and incorrect edit revision without retry", async () => {
  for (const changed of [{ conversationId: other }, { manuscriptId: id }, { revision: 0 }, { revision: 2 }]) {
    const invoke = vi.fn().mockResolvedValue({ ...response, ...changed });
    await expect(createAgentInputQueueGateway(invoke).edit(request)).rejects.toThrow();
    expect(invoke).toHaveBeenCalledTimes(1);
  }
});
it("keeps transport errors and does not replay unknown mutation outcomes", async () => {
  const failure = { code: "conflict" };
  const invoke = vi.fn().mockRejectedValue(failure);
  await expect(createAgentInputQueueGateway(invoke).edit(request)).rejects.toBe(failure);
  expect(invoke).toHaveBeenCalledTimes(1);
});
it("rejects invalid snapshots and impossible preparing heads", () => {
  for (const value of [
    { ...response, schemaVersion: 2 }, { ...response, revision: 0.5 }, { ...response, revision: Number.MAX_SAFE_INTEGER + 1 },
    { ...response, paused: 1 }, { ...response, preparingInputId: other }, { ...response, model: "extra" },
    { ...response, conversationId: "00000000-0000-0000-0000-000000000000" },
    { ...response, inputs: [response.inputs[0], response.inputs[0]] },
    { ...response, inputs: Array(65).fill(response.inputs[0]) },
    ...["", " ", "\ud800", "🧬".repeat(16385)].map((text) => ({ ...response, inputs: [{ inputId: id, text }] })),
    { ...response, inputs: [{ ...response.inputs[0], extra: true }] },
  ]) expect(() => decodeAgentWritingQueueResponse(value)).toThrow();
  expect(decodeAgentWritingQueueResponse({ ...response, preparingInputId: id }).preparingInputId).toBe(id);
});
it("rejects internal execution operations and extra parameters before invoking native", async () => {
  for (const edit of [
    { type: "prepare", inputId: id }, { type: "admitted", inputId: id }, { type: "release", inputId: id },
    { type: "pause", model: "override" }, { type: "reorder", inputIds: [id, id] },
    { type: "add", inputId: id, text: "\ud800" },
  ]) expect(() => decodeAgentWritingQueueEditRequest({ ...request, edit })).toThrow();
  const invoke = vi.fn();
  await expect(createAgentInputQueueGateway(invoke).edit({ ...request, expectedRevision: -1 })).rejects.toThrow();
  expect(invoke).not.toHaveBeenCalled();
});
