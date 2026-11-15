import { describe, expect, it } from "vitest";
import { decodeAgentPaperQueueEditRequest, decodeAgentPaperQueueResponse, decodeAgentPaperQueueScope } from "./paperQueue";
import { AgentSubmissionDecodeError } from "./submission";

const conversationId = "11111111-1111-4111-8111-111111111111";
const inputId = "22222222-2222-4222-8222-222222222222";

describe("paper queue contract", () => {
  it("round trips a scoped queue and edit", () => {
    const scope = decodeAgentPaperQueueScope({ conversationId, paperId: "paper-1" });
    const response = decodeAgentPaperQueueResponse({ schemaVersion: 1, conversationId, paperId: "paper-1", revision: 1,
      paused: false, preparingInputId: null, inputs: [{ inputId, text: "继续解释" }] });
    expect(response).toMatchObject({ ...scope, revision: 1, inputs: [{ inputId, text: "继续解释" }] });
    expect(decodeAgentPaperQueueEditRequest({ conversationId, paperId: "paper-1", requestId: inputId,
      expectedRevision: 1, edit: { type: "remove", inputId } }).edit).toEqual({ type: "remove", inputId });
  });
  it("rejects renderer supplied origins and malformed paper identities", () => {
    expect(() => decodeAgentPaperQueueScope({ conversationId, paperId: "" })).toThrow(AgentSubmissionDecodeError);
    expect(() => decodeAgentPaperQueueEditRequest({ conversationId, paperId: "paper-1", requestId: inputId,
      expectedRevision: 0, edit: { type: "add", inputId, text: "x", origin: { kind: "paper", resourceId: "paper-1" } } })).toThrow(AgentSubmissionDecodeError);
  });
});
