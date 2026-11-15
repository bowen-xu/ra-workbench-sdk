import { describe, expect, it } from "vitest";
import { decodeAiCandidatePayload } from "./schema";
import { decodePaperTemplateSnapshot, overviewFieldTitle } from "./paperTemplate";

const template = { portraitCandidateId: "portrait", portraitRevision: 2, fields: [
  { id: "model_assumptions", title: "模型假设", question: "定义和前提是什么？", claimIds: ["claim_1"] },
  { id: "validation_basis", title: "验证依据", question: "怎样检验？", claimIds: [] },
] };
const sample = () => ({ kind: "paper_overview_unit_v1", schemaVersion: 1, profileId: "paper_template_v1", paperTemplate: template,
  fields: [ { field: "model_assumptions", status: "partial", statements: [{ id: "s1", text: "Explicit model", epistemicRole: "source_paraphrase", evidenceItemIds: ["E1"], evidenceQuotes: [{ evidenceItemId: "E1", quote: "explicit model" }] }] },
    { field: "validation_basis", status: "not_found", statements: [] } ] });
const context = { allowedEvidenceItemIds: new Set(["E1", "E2"]) };
describe("per-paper extraction schema", () => {
  it("preserves full source quotations longer than 1200 characters", () => {
    for (const quote of ["x".repeat(1224), "原文🙂".repeat(2000)]) {
      const input = sample();
      input.fields[0]!.statements[0]!.evidenceQuotes[0]!.quote = quote;
      expect(decodeAiCandidatePayload(input, context)).toEqual(input);
    }
  });
  it("keeps custom fields, definitions and their order with source quotes", () => {
    const decoded = decodeAiCandidatePayload(sample(), context);
    expect(decoded.kind).toBe("paper_overview_unit_v1");
    expect(overviewFieldTitle(sample(), "model_assumptions")).toBe("模型假设");
    expect(decodePaperTemplateSnapshot(template)).toEqual(template);
  });
  it("rejects omitted, reordered and foreign fields and missing quotes", () => {
    expect(() => decodeAiCandidatePayload({ ...sample(), fields: [...sample().fields].reverse() }, context)).toThrow();
    expect(() => decodeAiCandidatePayload({ ...sample(), fields: sample().fields.slice(0, 1) }, context)).toThrow();
    const input = sample(); input.fields[0]!.field = "foreign";
    expect(() => decodeAiCandidatePayload(input, context)).toThrow();
    const missing = sample(); missing.fields[0]!.statements[0]!.evidenceQuotes = [];
    expect(() => decodeAiCandidatePayload(missing, context)).toThrow();
    const cited = sample(); cited.fields[0]!.statements[0]!.evidenceItemIds.push("E2");
    expect(() => decodeAiCandidatePayload(cited, context)).toThrow();
  });
  it("does not reinterpret a custom template as a legacy framework", () => {
    expect(() => decodeAiCandidatePayload({ ...sample(), profileId: "generic_overview_v1" }, context)).toThrow();
    expect(() => decodeAiCandidatePayload({ ...sample(), profileRefs: [] }, context)).toThrow();
  });
});

it("decodes an immutable global template reference without disguising it as a portrait candidate",()=>{
  const input={templateResourceId:"template-object",templateResourceRevision:4,fields:[{id:"question",title:"问题",question:"研究目标"}]};
  expect(decodePaperTemplateSnapshot(input)).toEqual({...input,fields:[{...input.fields[0],claimIds:[]}]});
  expect(()=>decodePaperTemplateSnapshot({...input,portraitCandidateId:"mixed",portraitRevision:1})).toThrow();
});
