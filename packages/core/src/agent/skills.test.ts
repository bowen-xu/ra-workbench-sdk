import { describe, expect, it } from "vitest";
import { decodeSubmissionSkills } from "./skills";
const fail = (): never => { throw new Error("invalid"); };
const skill = { descriptor: { identity: { environment_id: "paper", source_id: "review/SKILL.md", revision: "v1" }, name: "Review", description: "Review text", allow_implicit_invocation: false }, explicit: true };
describe("frozen submission skills", () => {
  it("preserves version and host invocation policy", () => {
    expect(decodeSubmissionSkills([skill], fail)).toEqual([skill]);
    expect(decodeSubmissionSkills([], fail)).toEqual([]);
  });
  it("rejects forged native paths, duplicate identities, malformed text and oversized metadata", () => {
    for (const input of [
      [{ ...skill, root: "/tmp/forged" }],
      [skill, { ...skill, descriptor: { ...skill.descriptor, identity: { ...skill.descriptor.identity, revision: "v2" } } }],
      [{ ...skill, explicit: "true" }],
      [{ ...skill, descriptor: { ...skill.descriptor, name: "\ud800" } }],
      [{ ...skill, descriptor: { ...skill.descriptor, description: "x".repeat(65537) } }],
    ]) expect(() => decodeSubmissionSkills(input, fail)).toThrow();
  });
});

import { decodeAgentSubmissionPreview } from "./submission";
it("round-trips optional skills through the complete submission preview decoder", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const legacy = { schemaVersion: 1, conversationId: id, requestId: id, manuscriptId: id, turnId: id, contextSnapshotId: id,
    input: { text: "Review", model: { providerId: "fixture", modelId: "test", revision: null }, reasoningEffort: null, context: [] } };
  expect(decodeAgentSubmissionPreview(legacy)).toEqual(legacy);
  const current = { ...legacy, input: { ...legacy.input, skills: [skill] } };
  expect(decodeAgentSubmissionPreview(current)).toEqual(current);
});
