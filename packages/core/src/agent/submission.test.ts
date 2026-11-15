import { describe, expect, it } from "vitest";
import { decodeAgentInstructionConfigOverride, decodeAgentSubmissionInput, executionModeForModel } from "./submission";

describe("frozen remote compaction choice", () => {
  const input = { text: "hello", model: { providerId: "openai", modelId: "example", revision: null }, reasoningEffort: null, context: [] };
  it("accepts old inputs and preserves an explicitly frozen choice", () => {
    expect(decodeAgentSubmissionInput(input)).toEqual(input);
    expect(decodeAgentSubmissionInput({ ...input, remoteCompactionV2: false }).remoteCompactionV2).toBe(false);
    expect(decodeAgentSubmissionInput({ ...input, remoteCompactionV2: true }).remoteCompactionV2).toBe(true);
  });
  it("rejects invalid choices and choices for other providers", () => {
    expect(() => decodeAgentSubmissionInput({ ...input, remoteCompactionV2: "false" })).toThrow();
    expect(() => decodeAgentSubmissionInput({ ...input, model: { ...input.model, providerId: "deepseek" }, remoteCompactionV2: false })).toThrow();
  });
});

describe("shared execution mode policy", () => {
  it("selects the reviewed DeepSeek profile only without reasoning effort", () => {
    expect(executionModeForModel({ providerId: "deepseek", modelId: "deepseek-v4-pro" })).toBe("deepSeekNonThinking");
    expect(executionModeForModel({ providerId: "deepseek", modelId: "deepseek-v4-flash" }, null)).toBe("deepSeekNonThinking");
    expect(executionModeForModel({ providerId: "deepseek", modelId: "deepseek-v4-pro" }, "high")).toBeNull();
  });

  it("accepts the reviewed ChatGPT profile with supported effort values", () => {
    expect(executionModeForModel({ providerId: "openai", modelId: "gpt-5.6-terra" })).toBe("chatGptDefault");
    expect(executionModeForModel({ providerId: "openai", modelId: "gpt-5.6-terra" }, "xhigh")).toBe("chatGptDefault");
    expect(executionModeForModel({ providerId: "openai", modelId: "gpt-5.6-sol" }, "xhigh")).toBe("chatGptDefault");
    expect(executionModeForModel({ providerId: "openai", modelId: "gpt-5.6-sol" }, "none")).toBeNull();
    expect(executionModeForModel({ providerId: "openai", modelId: "gpt-5.6-terra" }, "none")).toBeNull();
  });

  it("rejects models outside the reviewed host policy", () => {
    expect(executionModeForModel({ providerId: "openai", modelId: "gpt-5.5" })).toBeNull();
    expect(executionModeForModel({ providerId: "deepseek", modelId: "deepseek-chat" })).toBeNull();
  });
});

describe("agent instruction config overrides", () => {
  it("accepts omitted optional fields as empty patches", () => {
    expect(decodeAgentInstructionConfigOverride({})).toEqual({ maxBytes: null, fallbackFilenames: null });
    expect(decodeAgentInstructionConfigOverride({ maxBytes: 0 })).toEqual({ maxBytes: 0, fallbackFilenames: null });
  });
  it("rejects unknown fields and unsafe fallback names", () => {
    expect(() => decodeAgentInstructionConfigOverride({ nope: 1 })).toThrow();
    expect(() => decodeAgentInstructionConfigOverride({ fallbackFilenames: ["../AGENTS.md"] })).toThrow();
  });
});
