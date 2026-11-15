import { describe, expect, it } from "vitest";
import { decodeAgentReadingNotePrepareRequest } from "./readingNoteSubmission";

const conversationId = "a1111111-1111-4111-8111-111111111111";
const requestId = "b1111111-1111-4111-8111-111111111111";
const readingNoteId = "c1111111-1111-4111-8111-111111111111";

describe("reading note submission contract", () => {
  it("preserves optional session and turn configuration overrides", () => {
    const request = decodeAgentReadingNotePrepareRequest({
      conversationId,
      requestId,
      text: "Summarize this note",
      context: { readingNoteId, expectedRevision: 3 },
      sessionConfig: { maxBytes: 4 },
      turnConfig: { fallbackFilenames: [] },
    });
    expect(request.sessionConfig).toEqual({ maxBytes: 4, fallbackFilenames: null });
    expect(request.turnConfig).toEqual({ maxBytes: null, fallbackFilenames: [] });
    expect(() => decodeAgentReadingNotePrepareRequest({
      conversationId,
      requestId,
      text: "Summarize this note",
      context: { readingNoteId, expectedRevision: 3 },
      turnConfig: { fallbackFilenames: ["../../unsafe.toml"] },
    })).toThrow();
  });
  it("decodes an optional retrieval trace", () => {
    const request = decodeAgentReadingNotePrepareRequest({ conversationId, requestId, text: "Use context", context: { readingNoteId, expectedRevision: 3 }, retrieval: { traceId: "trace-1", query: "autonomy" } });
    expect(request.retrieval).toEqual({ traceId: "trace-1", query: "autonomy" });
  });
});
