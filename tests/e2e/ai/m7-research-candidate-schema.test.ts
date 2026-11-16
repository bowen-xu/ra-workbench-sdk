import { describe, expect, it } from "vitest";
import {
  AiSchemaError,
  decodeAiCandidatePayload,
} from "../../../packages/core/src/ai/index";

const context = { allowedEvidenceItemIds: new Set(["E1", "E2", "E3"]) };

describe("M7 research candidate schemas", () => {
  it("decodes a reference record without treating AI fields as verified identity", () => {
    const value = decodeAiCandidatePayload({
      kind: "reference_record_candidate_v1",
      schemaVersion: 1,
      rawText: "Doe, J. (2024). Grounded research systems.",
      evidenceItemIds: ["E1"],
      fields: [
        { name: "title", value: "Grounded research systems", evidenceItemIds: ["E1"] },
        { name: "year", value: "2024", evidenceItemIds: ["E1"] },
      ],
      uncertainties: ["DOI was not present in the selected reference text."],
    }, context);

    expect(value.kind).toBe("reference_record_candidate_v1");
  });

  it("requires multi-source evidence for synthesis statements", () => {
    expect(() => decodeAiCandidatePayload({
      kind: "derived_research_view_v1",
      schemaVersion: 1,
      viewKind: "taxonomy",
      title: "Approach taxonomy",
      scopeNote: "Only the selected matrix cell revisions are in scope.",
      items: [{
        id: "item_1",
        text: "The papers form two approach families.",
        epistemicRole: "synthesis",
        evidenceItemIds: ["E1"],
        hasConflict: false,
      }],
    }, context)).toThrow(AiSchemaError);
  });

  it("rejects factualized gaps and evidence outside the frozen bundle", () => {
    expect(() => decodeAiCandidatePayload({
      kind: "derived_research_view_v1",
      schemaVersion: 1,
      viewKind: "gap_hypothesis",
      title: "Candidate gaps",
      scopeNote: "A hypothesis based on selected evidence only.",
      items: [{
        id: "gap_1",
        text: "No paper evaluates long-term retention.",
        epistemicRole: "inference",
        evidenceItemIds: ["OUTSIDE"],
        hasConflict: false,
      }],
    }, context)).toThrow(AiSchemaError);
  });
});
