import { describe, expect, it } from "vitest";

import { AiSchemaError, decodeAiCandidatePayload } from "./schema";

const evidence = new Set(["P1-T1", "P1-T2", "P1-T3", "P1-R1"]);

function payload(): Record<string, unknown> {
  return {
    kind: "paper_concept_map_v1",
    schemaVersion: 1,
    concepts: [
      {
        id: "concept_x",
        preferredTerm: "Concept X",
        surfaceForms: [
          { text: "Concept X", language: "en", relationKind: "preferred", evidenceItemIds: ["P1-T1"] },
          { text: "X", language: "en", relationKind: "abbreviation", evidenceItemIds: ["P1-T2"] },
        ],
        paperFunction: "focal",
        noveltyStatus: "introduced_by_paper",
        explanationStatus: "explained_in_paper",
        explanation: "A source-grounded identity explanation.",
        disambiguation: "Distinct from an earlier use of X.",
        roleRationale: "The contribution is organized around it.",
        noveltyRationale: "The authors explicitly introduce the label.",
        definitionClaims: [{
          id: "definition_x",
          statement: "The paper defines Concept X as a constrained process.",
          scopeNote: "For the paper's experimental setting.",
          evidenceItemIds: ["P1-T1"],
        }],
        evidenceItemIds: ["P1-T1", "P1-T2"],
        referenceMentions: [],
      },
      {
        id: "concept_y",
        preferredTerm: "Foundation Y",
        surfaceForms: [
          { text: "Foundation Y", relationKind: "preferred", evidenceItemIds: ["P1-T3"] },
        ],
        paperFunction: "foundational",
        noveltyStatus: "pre_existing",
        explanationStatus: "mentioned_only",
        explanation: "",
        disambiguation: "",
        roleRationale: "The method assumes Y.",
        noveltyRationale: "The paper cites prior work.",
        definitionClaims: [],
        evidenceItemIds: ["P1-T3"],
        referenceMentions: [{
          citationText: "Smith 2021",
          citedKey: "smith-2021",
          evidenceItemIds: ["P1-R1"],
        }],
      },
    ],
    relations: [{
      id: "relation_x_y",
      subjectConceptCandidateId: "concept_x",
      predicateKind: "builds_on",
      objectConceptCandidateId: "concept_y",
      scopeNote: "X inherits the constraints of Y.",
      evidenceItemIds: ["P1-T2"],
    }],
    omissions: [{ term: "ordinary term", reason: "not_key", evidenceItemIds: ["P1-T3"] }],
  };
}

describe("paper_concept_map_v1", () => {
  it("decodes multiple surface forms, source definitions, references and relations", () => {
    const decoded = decodeAiCandidatePayload(payload(), { allowedEvidenceItemIds: evidence });
    expect(decoded.kind).toBe("paper_concept_map_v1");
    if (decoded.kind !== "paper_concept_map_v1") throw new Error("unexpected kind");
    expect(decoded.concepts).toHaveLength(2);
    expect(decoded.concepts[0]?.surfaceForms).toHaveLength(2);
    expect(decoded.relations[0]?.predicateKind).toBe("builds_on");
  });

  it("rejects a mentioned-only concept without a reference clue", () => {
    const value = payload();
    const concepts = value.concepts as Array<Record<string, unknown>>;
    concepts[1] = { ...concepts[1], referenceMentions: [] };
    expectSchemaError(value, "evidence_requirement_not_met");
  });

  it("rejects an introduced concept without direct evidence", () => {
    const value = payload();
    const concepts = value.concepts as Array<Record<string, unknown>>;
    concepts[0] = { ...concepts[0], evidenceItemIds: [] };
    expectSchemaError(value, "evidence_requirement_not_met");
  });

  it("rejects unknown context IDs", () => {
    const value = payload();
    const concepts = value.concepts as Array<Record<string, unknown>>;
    concepts[0] = { ...concepts[0], evidenceItemIds: ["P9-UNKNOWN"] };
    expectSchemaError(value, "unknown_evidence_id");
  });

  it("rejects duplicate local concept IDs", () => {
    const value = payload();
    const concepts = value.concepts as Array<Record<string, unknown>>;
    concepts[1] = { ...concepts[1], id: "concept_x" };
    expectSchemaError(value, "duplicate_id");
  });

  it("rejects unknown relation endpoints and self loops", () => {
    const value = payload();
    const relations = value.relations as Array<Record<string, unknown>>;
    relations[0] = { ...relations[0], objectConceptCandidateId: "missing" };
    expectSchemaError(value, "invalid_value");

    const selfLoop = payload();
    const selfRelations = selfLoop.relations as Array<Record<string, unknown>>;
    selfRelations[0] = { ...selfRelations[0], objectConceptCandidateId: "concept_x" };
    expectSchemaError(selfLoop, "invalid_value");
  });

  it("rejects unknown fields", () => {
    const value = payload();
    const concepts = value.concepts as Array<Record<string, unknown>>;
    concepts[0] = { ...concepts[0], confidence: 0.9 };
    expectSchemaError(value, "unknown_field");
  });
});

function expectSchemaError(value: unknown, code: AiSchemaError["code"]): void {
  try {
    decodeAiCandidatePayload(value, { allowedEvidenceItemIds: evidence });
  } catch (error) {
    expect(error).toBeInstanceOf(AiSchemaError);
    expect((error as AiSchemaError).code).toBe(code);
    return;
  }
  throw new Error(`expected ${code}`);
}
