import { describe, expect, it } from "vitest";

import {
  AiSchemaError,
  calculateCitationMetrics,
  decodeAiCandidatePayload,
} from "../../../packages/core/src/ai/index";

const context = {
  allowedEvidenceItemIds: new Set(["ev-1", "ev-2"]),
};

describe("M6 knowledge and attention candidate schemas", () => {
  it("decodes concept suggestions without accepting knowledge object IDs", () => {
    const candidate = decodeAiCandidatePayload({
      kind: "concept_suggestion_v1",
      schemaVersion: 1,
      suggestions: [{
        id: "concept_1",
        term: "稀疏门控",
        language: "zh",
        explanation: "只激活候选专家中的一部分。",
        disambiguation: "混合专家模型中的路由机制",
        domain: "机器学习",
        epistemicRole: "source_paraphrase",
        evidenceItemIds: ["ev-1"],
      }],
    }, context);

    expect(candidate.kind).toBe("concept_suggestion_v1");
    expect(calculateCitationMetrics(candidate).citationCoverage).toBe(1);
    expect(() => decodeAiCandidatePayload({
      kind: "concept_suggestion_v1",
      schemaVersion: 1,
      suggestions: [{
        id: "concept_1",
        conceptId: "model-invented-stable-id",
        term: "稀疏门控",
        explanation: "解释",
        epistemicRole: "source_paraphrase",
        evidenceItemIds: ["ev-1"],
      }],
    }, context)).toThrowError(AiSchemaError);
  });

  it("decodes definition and controlled relation suggestions", () => {
    expect(decodeAiCandidatePayload({
      kind: "definition_suggestion_v1",
      schemaVersion: 1,
      suggestions: [{
        id: "definition_1",
        term: "专家",
        statement: "专家是被路由器选择的子网络。",
        scopeNote: "仅限当前模型架构",
        epistemicRole: "source_paraphrase",
        evidenceItemIds: ["ev-1"],
      }],
    }, context).kind).toBe("definition_suggestion_v1");

    const relation = {
      kind: "relation_suggestion_v1",
      schemaVersion: 1,
      suggestions: [{
        id: "relation_1",
        subjectTerm: "稀疏门控",
        predicateKind: "related_to",
        objectTerm: "混合专家",
        scopeNote: "模型路由语境",
        epistemicRole: "source_paraphrase",
        evidenceItemIds: ["ev-1"],
      }],
    };
    expect(decodeAiCandidatePayload(relation, context).kind).toBe("relation_suggestion_v1");
    expect(() => decodeAiCandidatePayload({
      ...relation,
      suggestions: [{ ...relation.suggestions[0], predicateKind: "proves" }],
    }, context)).toThrowError(AiSchemaError);
  });

  it("keeps attention priority separate from truth and requires inspectable evidence", () => {
    const candidate = decodeAiCandidatePayload({
      kind: "attention_suggestion_v1",
      schemaVersion: 1,
      suggestions: [{
        id: "attention_1",
        title: "关注路由器的负载均衡约束",
        reason: "它限定了稀疏激活是否会集中到少数专家。",
        priority: "high",
        evidenceItemIds: ["ev-2"],
      }],
    }, context);
    expect(candidate.kind).toBe("attention_suggestion_v1");
    expect("confidence" in candidate.suggestions[0]!).toBe(false);
    expect(() => decodeAiCandidatePayload({
      kind: "attention_suggestion_v1",
      schemaVersion: 1,
      suggestions: [{
        id: "attention_1",
        title: "关注某处",
        reason: "理由",
        priority: "high",
        evidenceItemIds: ["outside-scope"],
      }],
    }, context)).toThrowError(AiSchemaError);
  });

  it("requires two evidence items for synthesized knowledge suggestions", () => {
    expect(() => decodeAiCandidatePayload({
      kind: "definition_suggestion_v1",
      schemaVersion: 1,
      suggestions: [{
        id: "definition_1",
        term: "综合定义",
        statement: "跨片段综合得出的定义。",
        epistemicRole: "synthesis",
        evidenceItemIds: ["ev-1"],
      }],
    }, context)).toThrowError(AiSchemaError);
  });
});
