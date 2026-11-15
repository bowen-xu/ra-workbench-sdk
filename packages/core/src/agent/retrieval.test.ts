import { expect, it } from "vitest";
import { decodeAgentRetrievalSelection } from "./retrieval";

it("decodes bounded retrieval selections", () => {
  expect(decodeAgentRetrievalSelection({ traceId: "trace-1", query: "autonomy" })).toEqual({ traceId: "trace-1", query: "autonomy" });
});

it("rejects malformed, extra, control-character, and overlarge retrieval selections", () => {
  for (const value of [
    null,
    { traceId: "", query: "query" },
    { traceId: "trace", query: "\0query" },
    { traceId: "trace", query: "query", extra: true },
    { traceId: "x".repeat(161), query: "query" },
    { traceId: "trace", query: "x".repeat(16_385) },
  ]) expect(() => decodeAgentRetrievalSelection(value)).toThrow();
});
