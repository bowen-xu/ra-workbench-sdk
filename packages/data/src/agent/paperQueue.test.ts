import { describe, expect, it, vi } from "vitest";
import { createAgentPaperQueueGateway } from "./paperQueue";

const scope = { conversationId: "11111111-1111-4111-8111-111111111111", paperId: "paper-1" } as const;
const inputId = "22222222-2222-4222-8222-222222222222";
const state = { schemaVersion: 1, ...scope, revision: 1, paused: false, preparingInputId: null, inputs: [{ inputId, text: "queued" }] };

describe("paper queue gateway", () => {
  it("keeps the paper scope on reads and edits", async () => {
    const invoke = vi.fn().mockResolvedValue(state);
    const gateway = createAgentPaperQueueGateway(invoke);
    expect(await gateway.read(scope)).toEqual(state);
    expect(await gateway.edit({ ...scope, requestId: inputId, expectedRevision: 0, edit: { type: "add", inputId, text: "queued" } })).toEqual(state);
    expect(invoke).toHaveBeenNthCalledWith(1, "agent_read_paper_input_queue", { request: scope });
    expect(invoke).toHaveBeenNthCalledWith(2, "agent_edit_paper_input_queue", { request: expect.objectContaining({ paperId: scope.paperId }) });
  });
  it("passes the guarded epoch to the native write", async () => {
    const invoke = vi.fn().mockResolvedValue(state), gateway = createAgentPaperQueueGateway(invoke);
    const request = {...scope, requestId: inputId, expectedRevision: 0, expectedEpoch: inputId, edit: {type: "add" as const, inputId, text: "queued"}};
    await gateway.edit(request);
    expect(invoke).toHaveBeenCalledWith("agent_edit_paper_input_queue", {request});
  });
});
