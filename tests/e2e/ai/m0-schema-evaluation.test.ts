import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  AiSchemaError,
  decodeAiCandidatePayload,
  GENERIC_OVERVIEW_FIELDS,
  inspectAiCandidatePayload,
} from "../../../packages/core/src/ai/index";

const FIXTURE_ROOT = resolve(process.cwd(), "tests/fixtures/ai");

interface ProviderResponseFixture {
  readonly allowedEvidenceItemIds: readonly string[];
  readonly payload: unknown;
}

interface ScenarioFixture {
  readonly fixtureVersion: number;
  readonly license: string;
  readonly privacy: string;
  readonly annotationStatus: string;
  readonly cases: readonly {
    readonly id: string;
    readonly language: string;
    readonly category: string;
    readonly source: string;
    readonly query: string;
    readonly expected: {
      readonly answerability: string;
      readonly requiredSignals: readonly string[];
    };
  }[];
}

function readJsonFixture(path: string): unknown {
  return JSON.parse(readFileSync(resolve(FIXTURE_ROOT, path), "utf8"));
}

function readProviderFixture(path: string): ProviderResponseFixture {
  const input = readJsonFixture(path);
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error(`Invalid provider fixture: ${path}`);
  }
  const record = input as Record<string, unknown>;
  if (!Array.isArray(record.allowedEvidenceItemIds)) {
    throw new Error(`Missing evidence IDs: ${path}`);
  }
  const evidenceIds = record.allowedEvidenceItemIds.map((value) => {
    if (typeof value !== "string") throw new Error(`Invalid evidence ID: ${path}`);
    return value;
  });
  return { allowedEvidenceItemIds: evidenceIds, payload: record.payload };
}

function readScenarioFixture(): ScenarioFixture {
  return readJsonFixture("cases/m0-cases-v2.json") as ScenarioFixture;
}

describe("AI assistance M0 frozen schemas", () => {
  it("accepts a quote-first selection explanation and reports full citation coverage", () => {
    const fixture = readProviderFixture(
      "provider_responses/selection-explanation-zh-quote-first.json",
    );
    const result = inspectAiCandidatePayload(fixture.payload, {
      allowedEvidenceItemIds: new Set(fixture.allowedEvidenceItemIds),
    });

    expect(result.valid).toBe(true);
    if (!result.valid) throw new Error("expected valid quote-first fixture");
    expect(result.candidate.kind).toBe("selection_explanation_v1");
    expect(result.metrics).toEqual({
      statementCount: 2,
      statementWithEvidenceCount: 2,
      evidenceReferenceCount: 3,
      uniqueEvidenceItemCount: 2,
      citationCoverage: 1,
    });
  });

  it("accepts the complete generic overview while preserving an explicit empty field", () => {
    const fixture = readProviderFixture(
      "provider_responses/paper-overview-en-quote-first.json",
    );
    const candidate = decodeAiCandidatePayload(fixture.payload, {
      allowedEvidenceItemIds: new Set(fixture.allowedEvidenceItemIds),
    });

    expect(candidate.kind).toBe("paper_overview_unit_v1");
    if (candidate.kind !== "paper_overview_unit_v1") throw new Error("wrong candidate kind");
    expect(candidate.fields.map((field) => field.field)).toEqual(GENERIC_OVERVIEW_FIELDS);
    expect(candidate.fields.at(-1)).toEqual({
      field: "open_question",
      status: "not_found",
      statements: [],
    });
  });

  it("makes a free-form one-shot response fail at a stable, diagnostic schema boundary", () => {
    const fixture = readProviderFixture(
      "provider_responses/selection-explanation-one-shot-baseline.json",
    );
    const result = inspectAiCandidatePayload(fixture.payload, {
      allowedEvidenceItemIds: new Set(fixture.allowedEvidenceItemIds),
    });

    expect(result).toEqual({ valid: false, errorCode: "missing_field", errorPath: "$.kind" });
  });

  it("rejects evidence IDs that are outside the frozen bundle", () => {
    const fixture = readProviderFixture(
      "provider_responses/selection-explanation-unknown-evidence.json",
    );
    const result = inspectAiCandidatePayload(fixture.payload, {
      allowedEvidenceItemIds: new Set(fixture.allowedEvidenceItemIds),
    });

    expect(result).toEqual({
      valid: false,
      errorCode: "unknown_evidence_id",
      errorPath: "$.statements[0].evidenceItemIds[0]",
    });
  });

  it("rejects unknown kinds, versions, extra fields, and unsupported synthesis", () => {
    const base = {
      kind: "selection_explanation_v1",
      schemaVersion: 1,
      statements: [{
        id: "s1",
        text: "bounded",
        epistemicRole: "source_paraphrase",
        evidenceItemIds: ["ev-1"],
      }],
      uncertainties: [],
    };
    const context = { allowedEvidenceItemIds: new Set(["ev-1"]) };

    expect(() => decodeAiCandidatePayload({ ...base, kind: "future_kind_v9" }, context))
      .toThrowError(expect.objectContaining({ code: "unknown_kind" }));
    expect(() => decodeAiCandidatePayload({ ...base, schemaVersion: 2 }, context))
      .toThrowError(expect.objectContaining({ code: "unknown_schema_version" }));
    expect(() => decodeAiCandidatePayload({ ...base, rawResponse: "do not persist" }, context))
      .toThrowError(expect.objectContaining({ code: "unknown_field" }));
    expect(() => decodeAiCandidatePayload({
      ...base,
      statements: [{
        ...base.statements[0],
        epistemicRole: "synthesis",
      }],
    }, context)).toThrowError(expect.objectContaining({ code: "evidence_requirement_not_met" }));
  });

  it("exposes typed decoder errors without retaining rejected payload text", () => {
    try {
      decodeAiCandidatePayload(null, { allowedEvidenceItemIds: new Set() });
      throw new Error("decoder unexpectedly accepted null");
    } catch (error) {
      expect(error).toBeInstanceOf(AiSchemaError);
      if (!(error instanceof AiSchemaError)) throw error;
      expect(error.code).toBe("invalid_type");
      expect(error.path).toBe("$");
      expect(Object.keys(error)).toEqual(expect.arrayContaining(["code", "path"]));
      expect(Object.keys(error)).not.toContain("payload");
    }
  });
});

describe("AI assistance M0 scenario inventory", () => {
  it("freezes balanced Chinese and English synthetic cases for every required category", () => {
    const fixture = readScenarioFixture();
    expect(fixture.fixtureVersion).toBe(2);
    expect(fixture.license).toBe("CC0-1.0 synthetic text");
    expect(fixture.privacy).toContain("synthetic");
    expect(fixture.annotationStatus).toBe("pending_human_review");
    expect(fixture.cases).toHaveLength(48);

    const categories = [
      "selection_explanation",
      "paper_overview",
      "unanswerable",
      "citation_conflict",
      "stale_anchor",
      "prompt_injection",
      "reference_extraction",
      "term_disambiguation",
    ];
    for (const category of categories) {
      expect(
        fixture.cases.filter((item) => item.category === category).map((item) => item.language).sort(),
      ).toEqual(["en", "en", "en", "zh", "zh", "zh"]);
    }
    expect(fixture.cases.filter((item) => item.language === "zh")).toHaveLength(24);
    expect(fixture.cases.filter((item) => item.language === "en")).toHaveLength(24);
    expect(
      fixture.cases.reduce((total, item) => total + item.expected.requiredSignals.length, 0),
    ).toBeGreaterThanOrEqual(100);
    expect(new Set(fixture.cases.map((item) => item.id)).size).toBe(fixture.cases.length);
    for (const item of fixture.cases) {
      expect(item.source.length).toBeGreaterThan(20);
      expect(item.query.length).toBeGreaterThan(3);
      expect(item.expected.requiredSignals.length).toBeGreaterThan(0);
      expect(item.source).not.toMatch(/sk-[a-z0-9]{8,}/iu);
    }
  });

  it("keeps prompt injection as inert fixture text and never as an expected action", () => {
    const fixture = readScenarioFixture();
    const injections = fixture.cases.filter((item) => item.category === "prompt_injection");
    expect(injections).toHaveLength(6);
    for (const item of injections) {
      expect(item.expected.requiredSignals.join(" ")).toMatch(/不得扩大范围|do not expand scope/u);
      expect(item.expected.requiredSignals.join(" ")).not.toMatch(/call|调用网络/u);
    }
  });
});
