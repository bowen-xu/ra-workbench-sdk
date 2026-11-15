import { decodePaperTemplateSnapshot } from "./paperTemplate";
import { describe, expect, it } from "vitest";
import { decodeAiCandidatePayload } from "./schema";
import { DEFAULT_PORTRAIT_TEMPLATE, PORTRAIT_DIMENSIONS, decodePaperPortrait, validatePortraitQuotes } from "./paperPortrait";
const sample = () => ({ kind: "paper_portrait_v1", schemaVersion: 1, coverage: "仅第 1 页摘录。", claims: PORTRAIT_DIMENSIONS.map((dimension, i) => ({ id: `claim_${i}`, dimension, label: "形式描述", description: "明确界定了模型。", certainty: "supported", evidence: [{ evidenceItemId: "E1", quote: "explicit model" }] })), template: DEFAULT_PORTRAIT_TEMPLATE });
const context = { allowedEvidenceItemIds: new Set(["E1"]) };
describe("paper portrait trust boundary", () => {
  it("decodes mixed claims and per-paper templates independently of old reading profiles", () => {
    const result = decodeAiCandidatePayload(sample(), context);
    expect(result.kind).toBe("paper_portrait_v1");
    const portrait = decodePaperPortrait(sample(), context);
    validatePortraitQuotes(portrait, [{ citationKey: "E1", quoteExact: "An explicit model is described." }]);
    expect(portrait.template.map(field => field.title)).toEqual(["问题", "方法", "结果", "结论", "局限", "开放问题"]);
  });
  it("generates three dimensions while decoding removed dimensions without rewriting history", () => {
    expect(PORTRAIT_DIMENSIONS).toEqual(["genre", "mode", "paradigm"]);
    const legacy = { ...sample(), claims: [...sample().claims, { ...sample().claims[0]!, id: "old_contribution", dimension: "contribution" }, { ...sample().claims[0]!, id: "old_structure", dimension: "structure" }] };
    expect(decodePaperPortrait(legacy, context).claims.at(-1)?.dimension).toBe("structure");
    expect(legacy.claims).toHaveLength(5);
  });
  it("rejects fabricated quotations, missing dimensions and foreign references", () => {
    expect(() => validatePortraitQuotes(decodePaperPortrait(sample(), context), [{ citationKey: "E1", quoteExact: "Different source." }])).toThrow();
    expect(() => decodePaperPortrait({ ...sample(), claims: sample().claims.slice(1) }, context)).toThrow();
    expect(() => decodePaperPortrait(sample(), { allowedEvidenceItemIds: new Set() })).toThrow();
    expect(() => decodePaperPortrait({ ...sample(), template: [{ ...DEFAULT_PORTRAIT_TEMPLATE[0], claimIds: ["foreign"] }] }, context)).toThrow();
  });
  it("permits explicit uncertainty without inventing evidence", () => {
    const input = sample(); input.claims = input.claims.map(value => ({ ...value, certainty: "uncertain", evidence: [] }));
    expect(decodePaperPortrait(input, context).claims[0]?.certainty).toBe("uncertain");
    expect(() => decodePaperPortrait({ ...sample(), claims: sample().claims.map(value => ({ ...value, evidence: [] })) }, context)).toThrow();
  });
});

it("freezes custom dimension definitions and rejects unknown, duplicate, or missing custom classifications", () => {
  const dimension = { id: "custom_access", title: "开放程度", description: "研究材料可获取与复用的程度。" };
  const payload = { ...sample(), customDimensions: [dimension], claims: [...sample().claims,
    { id: "access", dimension: dimension.id, label: "不确定", description: "材料不足。", certainty: "uncertain", evidence: [] }] };
  expect(decodePaperPortrait(payload, context).customDimensions).toEqual([dimension]);
  expect(() => decodePaperPortrait({ ...payload, customDimensions: [] }, context)).toThrow();
  expect(() => decodePaperPortrait({ ...payload, customDimensions: [dimension, dimension] }, context)).toThrow();
  expect(() => decodePaperPortrait({ ...payload, claims: sample().claims }, context)).toThrow();
});

it("freezes explicit field colors and rejects CSS payloads in portraits and template snapshots", () => {
  const input = { ...sample(), template: [{ ...DEFAULT_PORTRAIT_TEMPLATE[0]!, color: "#123456" }] };
  expect(decodePaperPortrait(input, context).template[0]?.color).toBe("#123456");
  const snapshot = { portraitCandidateId: "portrait", portraitRevision: 1, fields: input.template };
  expect(decodePaperTemplateSnapshot(snapshot).fields[0]?.color).toBe("#123456");
  for (const color of ["red", "#fff", "url(example)", "#12345g", 12]) {
    const fields = [{ ...input.template[0], color }];
    expect(() => decodePaperPortrait({ ...input, template: fields }, context)).toThrow();
    expect(() => decodePaperTemplateSnapshot({ ...snapshot, fields })).toThrow();
  }
});
