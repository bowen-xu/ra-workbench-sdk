import { describe, expect, it } from "vitest";
import { decodePaperPortrait, type PaperPortraitCandidateV1 } from "./paperPortrait";
import { DEFAULT_PORTRAIT_CATALOG, decodePortraitCatalog, portraitGenerationGoal, portraitTagDefinition, togglePortraitTag } from "./portraitCatalog";
const portrait = (): PaperPortraitCandidateV1 => ({ kind: "paper_portrait_v1", schemaVersion: 1, coverage: "one page",
  claims: ["genre", "mode", "paradigm", "contribution"].map((dimension, index) => ({ id: `claim_${index}`, dimension: dimension as "genre" | "mode" | "paradigm" | "contribution", label: "原有判断", description: "model", certainty: "supported", evidence: [{ evidenceItemId: "E1", quote: "model" }] })),
  template: [{ id: "question", title: "问题", question: "研究所回应的问题。", claimIds: ["claim_0", "claim_3"] }] });
describe("portrait catalog and selection", () => {
  it("retains evidence and stable identities of unaffected claims, pruning only removed references", () => {
    const original = portrait();
    const added = togglePortraitTag(original, "genre", "原创研究", "new_genre");
    expect(added.claims[0]).toEqual(original.claims[0]);
    expect(added.claims.at(-1)).toMatchObject({ certainty: "uncertain", evidence: [] });
    const removed = togglePortraitTag(added, "genre", "原有判断", "unused");
    expect(removed.template[0]?.claimIds).toEqual(["claim_3"]);
    expect(removed.claims.find(value => value.id === "claim_3")).toEqual(original.claims[3]);
    expect(original.claims).toHaveLength(4);
    expect(() => decodePaperPortrait(removed, { allowedEvidenceItemIds: new Set(["E1"]) })).not.toThrow();
  });
  it("retains required classifications and legacy claims when the last selected label is cleared", () => {
    const cleared = togglePortraitTag(portrait(), "genre", "原有判断", "unused");
    expect(cleared.claims[0]).toMatchObject({ label: "不确定", evidence: [], certainty: "uncertain" });
    const replaced = togglePortraitTag(cleared, "genre", "综述", "unused");
    expect(replaced.claims[0]?.id).toBe("claim_0");
    expect(() => decodePaperPortrait(replaced, { allowedEvidenceItemIds: new Set(["E1"]) })).not.toThrow();
  });
  it("rejects malformed, duplicate, or oversized configuration rather than passing it to generation", () => {
    expect(decodePortraitCatalog(DEFAULT_PORTRAIT_CATALOG)).toEqual(DEFAULT_PORTRAIT_CATALOG);
    expect(() => decodePortraitCatalog({ ...DEFAULT_PORTRAIT_CATALOG, tags: { ...DEFAULT_PORTRAIT_CATALOG.tags, genre: [{ label: "x", description: "" }] } })).toThrow();
    expect(() => decodePortraitCatalog({ ...DEFAULT_PORTRAIT_CATALOG, tags: { ...DEFAULT_PORTRAIT_CATALOG.tags, genre: [DEFAULT_PORTRAIT_CATALOG.tags.genre[0], DEFAULT_PORTRAIT_CATALOG.tags.genre[0]] } })).toThrow();
    expect(() => decodePortraitCatalog({ ...DEFAULT_PORTRAIT_CATALOG, templates: [{ ...DEFAULT_PORTRAIT_CATALOG.templates[0], fields: [{ id: "field", title: "x", question: "x", claimIds: ["paper-specific"] }] }] })).toThrow();
  });
  it("accepts managed template UUIDs without changing identity or field definitions", () => {
    const catalog = { ...DEFAULT_PORTRAIT_CATALOG, templates: DEFAULT_PORTRAIT_CATALOG.templates.map((template, index) => ({
      ...template, id: `12345678-1234-4234-8234-${String(index).padStart(12, "0")}`,
    })) };
    expect(decodePortraitCatalog(JSON.parse(JSON.stringify(catalog)))).toEqual(catalog);
  });
  it("distinguishes invalid template identities from invalid field definitions", () => {
    const template = DEFAULT_PORTRAIT_CATALOG.templates[0]!;
    const decode = (value: unknown) => decodePortraitCatalog({ ...DEFAULT_PORTRAIT_CATALOG, templates: [value] });
    expect(() => decode({ ...template, id: "123-not-a-uuid" })).toThrow("阅读模板标识无效或重复");
    expect(() => decodePortraitCatalog({ ...DEFAULT_PORTRAIT_CATALOG, templates: [template, template] })).toThrow("阅读模板标识无效或重复");
    expect(() => decode({ ...template, fields: [] })).toThrow("每个阅读模板需有 1–20 个字段");
    expect(() => decode({ ...template, fields: [{ ...template.fields[0], id: "12345678-1234-4234-8234-123456789012" }] })).toThrow("阅读模板字段标识无效或重复");
    expect(() => decode({ ...template, fields: [template.fields[0], template.fields[0]] })).toThrow("阅读模板字段标识无效或重复");
    expect(() => decode({ ...template, fields: [{ ...template.fields[0], question: "" }] })).toThrow("阅读模板字段需填写有效名称和说明");
    expect(() => decode({ ...template, fields: [{ ...template.fields[0], claimIds: ["paper-claim"] }] })).toThrow("阅读模板字段不能引用具体论文的画像判断");
  });
  it("freezes reusable definitions, not per-paper content, into the generation goal", () => {
    const goal = portraitGenerationGoal(DEFAULT_PORTRAIT_CATALOG);
    expect(goal).toContain("模板说明定义结构标题的含义");
    expect(goal).toContain("仅提及术语不构成概念分析");
    expect(goal).not.toContain("NAL");
    expect(goal).toContain("包含文献类型、知识形态、研究范式及配置中的自定义维度");
    expect(encodeURIComponent(goal).replace(/%[\dA-F]{2}|[^%]/gu, "x").length).toBeLessThan(64_000);
    expect(DEFAULT_PORTRAIT_CATALOG.templates.find(template => template.id === "formal")?.fields).toHaveLength(9);
    expect(DEFAULT_PORTRAIT_CATALOG.templates.find(template => template.id === "empirical")?.fields).toHaveLength(8);
  });
  it("resolves legacy label aliases to abstract definitions and honors exact configured overrides", () => {
    const tags = DEFAULT_PORTRAIT_CATALOG.tags;
    expect(portraitTagDefinition(tags, "genre", "原创研究 / 探索性方法论文")).toBe(tags.genre[0]?.description);
    expect(portraitTagDefinition(tags, "paradigm", "计算模型构建＋基准评测")).not.toContain("MNIST");
    expect(portraitTagDefinition({ ...tags, genre: [...tags.genre, { label: "原创研究／探索性方法论文", description: "自定义的独立标签定义。" }] }, "genre", "原创研究／探索性方法论文")).toBe("自定义的独立标签定义。");
  });
});

it("persists bounded custom dimensions and their tag definitions without allowing orphan tags", () => {
  const dimension = { id: "custom_access", title: "开放程度", description: "材料的可获取程度。" };
  const config = { ...DEFAULT_PORTRAIT_CATALOG, customDimensions: [dimension], tags: { ...DEFAULT_PORTRAIT_CATALOG.tags, custom_access: [{ label: "开放", description: "材料公开可获取。" }] } };
  expect(decodePortraitCatalog(JSON.parse(JSON.stringify(config)))).toEqual(config);
  expect(portraitGenerationGoal(decodePortraitCatalog(config))).toContain("custom_access");
  expect(portraitTagDefinition(decodePortraitCatalog(config).tags, "custom_access", "开放")).toBe("材料公开可获取。");
  expect(() => decodePortraitCatalog({ ...config, customDimensions: [] })).toThrow();
  expect(() => decodePortraitCatalog({ ...config, customDimensions: Array(6).fill(dimension) })).toThrow();
});
