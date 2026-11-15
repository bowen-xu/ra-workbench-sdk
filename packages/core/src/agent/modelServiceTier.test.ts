import { describe, expect, it } from "vitest";
import { decodeAgentModelSelection, decodeAgentSubmissionInput } from "./submission";

describe("frozen model service tier", () => {
  const input = { text: "question", model: { providerId: "openai", modelId: "gpt-5.6-terra", revision: null }, reasoningEffort: "medium", context: [] };
  it("preserves optional tier across submission decoding without changing old inputs", () => {
    expect(decodeAgentSubmissionInput(input)).not.toHaveProperty("serviceTier");
    expect(decodeAgentSubmissionInput({ ...input, serviceTier: "fast" })).toEqual({ ...input, serviceTier: "fast" });
    expect(decodeAgentModelSelection({ providerId: "openai", modelId: "gpt-5.6-terra", serviceTier: "default" })).toMatchObject({ serviceTier: "default" });
  });
  it("rejects invalid tiers and attempts to use them with other providers", () => {
    expect(() => decodeAgentSubmissionInput({ ...input, serviceTier: "flex" })).toThrow();
    expect(() => decodeAgentModelSelection({ providerId: "deepseek", modelId: "deepseek-v4-pro", serviceTier: "fast" })).toThrow();
  });
});
