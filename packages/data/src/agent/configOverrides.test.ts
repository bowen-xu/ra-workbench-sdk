import { expect, it, vi } from "vitest";
import { type AgentWritingPrepareRequest } from "@research-assistant/core/agent";
import { createAgentSubmissionGateway } from "./submission";
import { createAgentInputQueuePreviewGateway } from "./inputQueuePreview";

it("rejects unsafe overrides before ordinary or queued preparation invokes native code", async () => {
  const invoke = vi.fn(async () => null);
  const request: AgentWritingPrepareRequest = {
    conversationId: "11111111-1111-4111-8111-111111111111",
    requestId: "22222222-2222-4222-8222-222222222222",
    text: "Review",
    context: { manuscriptId: "33333333-3333-4333-8333-333333333333", files: [] },
    sessionConfig: { fallbackFilenames: ["../AGENTS.md"] },
  };
  const direct = createAgentSubmissionGateway(invoke);
  await expect(async () => direct.prepareWriting(request)).rejects.toThrow();
  const queued = createAgentInputQueuePreviewGateway(invoke);
  await expect(queued.prepare({ inputId: request.requestId, expectedRevision: 0, submission: request })).rejects.toThrow();
  expect(invoke).not.toHaveBeenCalled();
});
