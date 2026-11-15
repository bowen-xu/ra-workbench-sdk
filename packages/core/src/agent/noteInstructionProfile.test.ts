import { describe, expect, it } from "vitest";
import { validateNoteInstructionProfile } from "./noteInstructionProfile";
import { decodeAgentSubmissionInput } from "./submission";

function fixture(kind: "note" | "readingNote", budget: number | null = 3) {
  const scope = `${kind === "note" ? "note" : "reading-note"}:id`;
  const source = `agent/config.toml#profiles.${kind === "note" ? "note" : "reading_note"}`;
  return {
    text: "question", model: { providerId: "fixture", modelId: "fixture", revision: null },
    reasoningEffort: null, context: [],
    instructions: [{ environmentId: scope, scopeId: scope, sourceId: source, revision: "a".repeat(64),
      text: budget === 0 ? "" : "中", originalBytes: 6, disposition: budget === 0 ? "budgetExcluded" : "truncated" }],
    instructionConfigs: [{ environment_id: scope, layers: [
      { origin: { tier: "user", source_id: source, revision: "a".repeat(64) },
        instructions: { max_bytes: 1, fallback_filenames: null } },
      { origin: { tier: "session", source_id: "profile:Session", revision: "b".repeat(64) },
        instructions: { max_bytes: 6, fallback_filenames: [] } },
      { origin: { tier: "turn", source_id: "profile:Turn", revision: "c".repeat(64) },
        instructions: { max_bytes: budget, fallback_filenames: null } },
    ] }],
  };
}

describe.each(["note", "readingNote"] as const)("%s frozen profile response", kind => {
  const validate = (value: unknown) => validateNoteInstructionProfile(decodeAgentSubmissionInput(value), kind, "id");
  it.each([0, 3, null])("accepts effective budget %s, including inheritance and exclusion", budget => {
    expect(() => validate(fixture(kind, budget))).not.toThrow();
  });
  it("measures UTF-8 against the final budget", () => {
    expect(() => validate(fixture(kind, 2))).toThrow();
  });
  it.each([true, false])("accepts frozen application skills (explicit=%s) with or without a profile", explicit => {
    const skills = [{ descriptor: {
      identity: { environment_id: "application", source_id: ".agents/skills/review/SKILL.md", revision: "d".repeat(64) },
      name: "review", description: "Review prose", allow_implicit_invocation: false,
    }, explicit }];
    const withProfile = { ...fixture(kind), skills };
    expect(() => validate(withProfile)).not.toThrow();
    expect(() => validate({ ...withProfile, instructions: [], instructionConfigs: [] })).not.toThrow();
    skills[0]!.descriptor.identity.environment_id = "manuscript:other";
    expect(() => validate(withProfile)).toThrow();
    skills[0]!.descriptor.identity.environment_id = "application";
    skills[0]!.descriptor.identity.source_id = ".agents/skills-other/review/SKILL.md";
    expect(() => validate(withProfile)).toThrow();
  });
  it("rejects malformed provenance, foreign hosts, duplicate and reordered layers", () => {
    const wrongSource = fixture(kind);
    wrongSource.instructionConfigs[0]!.layers[1]!.origin.source_id = "profile:Turn";
    const wrongTier = fixture(kind);
    wrongTier.instructionConfigs[0]!.layers[1]!.origin.tier = "workspace";
    const wrongRevision = fixture(kind);
    wrongRevision.instructionConfigs[0]!.layers[1]!.origin.revision = "not-a-hash";
    const foreign = fixture(kind);
    foreign.instructions[0]!.scopeId = "paper:id";
    const duplicate = fixture(kind);
    duplicate.instructionConfigs[0]!.layers.push(duplicate.instructionConfigs[0]!.layers[2]!);
    const reordered = fixture(kind);
    reordered.instructionConfigs[0]!.layers.reverse();
    for (const value of [wrongSource, wrongTier, wrongRevision, foreign, duplicate, reordered]) {
      expect(() => validate(value)).toThrow();
    }
  });
});
