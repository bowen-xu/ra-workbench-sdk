import {
  AiSchemaError, assertOnlyKeys, expectArray, expectEnum, expectRecord,
  expectRequiredString, type AiCandidateDecodeContext,
} from "./schemaSupport";

export const PORTRAIT_DIMENSIONS = ["genre", "mode", "paradigm"] as const;
// Decode immutable older snapshots without requiring or displaying their removed dimension.
const COMPATIBLE_PORTRAIT_DIMENSIONS = [...PORTRAIT_DIMENSIONS, "contribution", "structure"] as const;
export type CustomPortraitDimensionId = `custom_${string}`;
export interface CustomPortraitDimension { readonly id: CustomPortraitDimensionId; readonly title: string; readonly description: string }
export type PortraitDimension = typeof COMPATIBLE_PORTRAIT_DIMENSIONS[number] | CustomPortraitDimensionId;
export const PORTRAIT_DIMENSION_LABELS: Readonly<Record<typeof COMPATIBLE_PORTRAIT_DIMENSIONS[number], string>> = {
  genre: "文献类型", mode: "知识形态", paradigm: "研究范式", contribution: "核心贡献", structure: "组织结构",
};
export interface PortraitEvidence {
  readonly evidenceItemId: string;
  readonly quote: string;
}
export interface PortraitClaim {
  readonly id: string;
  readonly dimension: PortraitDimension;
  readonly label: string;
  readonly description: string;
  readonly certainty: "supported" | "uncertain";
  readonly evidence: readonly PortraitEvidence[];
}
export interface PortraitTemplateField {
  readonly id: string;
  readonly title: string;
  readonly question: string;
  readonly claimIds: readonly string[];
  readonly color?: string;
}
export function decodeReadingFieldColor(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^#[0-9a-fA-F]{6}$/.test(value)) throw new AiSchemaError("invalid_value", "$.template.color", "six-digit hex color required");
  return value;
}

export interface PaperPortraitCandidateV1 {
  readonly kind: "paper_portrait_v1";
  readonly schemaVersion: 1;
  readonly coverage: string;
  readonly claims: readonly PortraitClaim[];
  readonly template: readonly PortraitTemplateField[];
  readonly customDimensions?: readonly CustomPortraitDimension[];
}

/** Stable identities and frozen definitions keep custom classifications portable across catalog changes. */
export function decodeCustomPortraitDimensions(input: unknown): readonly CustomPortraitDimension[] {
  const values = expectArray(input, "$.customDimensions");
  if (values.length > 5) throw new AiSchemaError("limit_exceeded", "$.customDimensions", "at most five custom dimensions");
  const ids = new Set<string>();
  const titles = new Set<string>(Object.values(PORTRAIT_DIMENSION_LABELS));
  return values.map(raw => {
    const value = expectRecord(raw, "$.customDimensions", "custom dimension");
    assertOnlyKeys(value, ["id", "title", "description"], "$.customDimensions");
    const id = expectRequiredString(value, "id", "$.customDimensions", 64);
    const title = expectRequiredString(value, "title", "$.customDimensions", 120);
    if (!/^custom_[a-z0-9_-]+$/.test(id) || ids.has(id) || titles.has(title)) throw new AiSchemaError("duplicate_id", "$.customDimensions", "invalid or duplicate dimension");
    ids.add(id); titles.add(title);
    return { id: id as CustomPortraitDimensionId, title, description: expectRequiredString(value, "description", "$.customDimensions", 200) };
  });
}

export function portraitDimensions(portrait: Pick<PaperPortraitCandidateV1, "customDimensions">): readonly { readonly id: PortraitDimension; readonly title: string }[] {
  return [...PORTRAIT_DIMENSIONS.map(id => ({ id, title: PORTRAIT_DIMENSION_LABELS[id] })), ...(portrait.customDimensions ?? [])];
}

/** Validates identities and references; literal quotations are checked against the frozen bundle separately. */
export function decodePaperPortrait(input: unknown, context: AiCandidateDecodeContext): PaperPortraitCandidateV1 {
  const payload = expectRecord(input, "$", "paper portrait");
  assertOnlyKeys(payload, ["kind", "schemaVersion", "coverage", "claims", "template", "customDimensions"], "$");
  if (payload.kind !== "paper_portrait_v1" || payload.schemaVersion !== 1) throw new AiSchemaError("invalid_value", "$", "unsupported portrait schema");
  const ids = new Set<string>();
  const customDimensions = payload.customDimensions === undefined ? undefined : decodeCustomPortraitDimensions(payload.customDimensions);
  const allowedDimensions = [...COMPATIBLE_PORTRAIT_DIMENSIONS, ...(customDimensions ?? []).map(value => value.id)];
  const rawClaims = expectArray(payload.claims, "$.claims");
  if (rawClaims.length < 3 || rawClaims.length > 24) throw new AiSchemaError("limit_exceeded", "$.claims", "3–24 claims required");
  const claims = rawClaims.map((raw, index): PortraitClaim => {
    const path = `$.claims[${index}]`;
    const value = expectRecord(raw, path, "portrait claim");
    assertOnlyKeys(value, ["id", "dimension", "label", "description", "certainty", "evidence"], path);
    const id = expectRequiredString(value, "id", path, 64);
    if (!/^[a-z][a-z0-9_-]*$/.test(id) || ids.has(id)) throw new AiSchemaError("duplicate_id", path, "invalid or duplicate claim id");
    ids.add(id);
    const certainty = expectEnum(value.certainty, ["supported", "uncertain"] as const, `${path}.certainty`);
    const sources = expectArray(value.evidence, `${path}.evidence`);
    if (sources.length > 8 || certainty === "supported" && sources.length === 0) throw new AiSchemaError("evidence_requirement_not_met", path, "supported claims need evidence");
    const seen = new Set<string>();
    const evidence = sources.map((rawSource): PortraitEvidence => {
      const source = expectRecord(rawSource, path, "portrait evidence");
      assertOnlyKeys(source, ["evidenceItemId", "quote"], path);
      const evidenceItemId = expectRequiredString(source, "evidenceItemId", path, 80);
      const quote = expectRequiredString(source, "quote", path, 1200);
      if (!context.allowedEvidenceItemIds.has(evidenceItemId)) throw new AiSchemaError("unknown_evidence_id", path, "outside frozen evidence");
      const key = `${evidenceItemId}:${quote}`;
      if (seen.has(key)) throw new AiSchemaError("duplicate_id", path, "duplicate evidence");
      seen.add(key);
      return { evidenceItemId, quote };
    });
    return { id, dimension: expectEnum(value.dimension, allowedDimensions, path),
      label: expectRequiredString(value, "label", path, 120), description: expectRequiredString(value, "description", path, 2000), certainty, evidence };
  });
  if ([...PORTRAIT_DIMENSIONS, ...(customDimensions ?? []).map(value => value.id)].some(dimension => !claims.some(claim => claim.dimension === dimension))) throw new AiSchemaError("missing_field", "$.claims", "all configured classification dimensions required");
  const rawFields = expectArray(payload.template, "$.template");
  if (rawFields.length < 1 || rawFields.length > 20) throw new AiSchemaError("limit_exceeded", "$.template", "1–20 template fields required");
  const fieldIds = new Set<string>();
  const template = rawFields.map((raw, index): PortraitTemplateField => {
    const path = `$.template[${index}]`;
    const field = expectRecord(raw, path, "template field");
    assertOnlyKeys(field, ["id", "title", "question", "claimIds", "color"], path);
    const id = expectRequiredString(field, "id", path, 64);
    if (!/^[a-z][a-z0-9_-]*$/.test(id) || fieldIds.has(id)) throw new AiSchemaError("duplicate_id", path, "invalid or duplicate field id");
    fieldIds.add(id);
    const refs = expectArray(field.claimIds, path);
    if (refs.length > 24 || refs.some(ref => typeof ref !== "string" || !ids.has(ref)) || new Set(refs).size !== refs.length) throw new AiSchemaError("invalid_value", path, "invalid template claim references");
    return { id, title: expectRequiredString(field, "title", path, 120), question: expectRequiredString(field, "question", path, 1000), claimIds: refs as string[], ...(field.color === undefined ? {} : { color: decodeReadingFieldColor(field.color)! }) };
  });
  return { kind: "paper_portrait_v1", schemaVersion: 1, coverage: expectRequiredString(payload, "coverage", "$", 2000), claims, template, ...(customDimensions === undefined ? {} : { customDimensions }) };
}

export function validatePortraitQuotes(portrait: PaperPortraitCandidateV1, evidence: readonly { readonly citationKey: string; readonly quoteExact: string }[]): void {
  for (const claim of portrait.claims) for (const source of claim.evidence) {
    const original = evidence.find(item => item.citationKey === source.evidenceItemId);
    if (!original?.quoteExact.includes(source.quote)) throw new AiSchemaError("invalid_value", "$.claims.evidence.quote", "quote is not a literal substring of the frozen source");
  }
}

export const DEFAULT_PORTRAIT_TEMPLATE: readonly PortraitTemplateField[] = [
  ["question", "问题", "研究所回应的问题、目标及其重要性。"], ["method", "方法", "解决问题所采用的方法、步骤及适用条件。"], ["result", "结果", "研究材料和分析所支持的主要发现。"], ["conclusion", "结论", "结果或论证所支持的结论及其成立条件。"], ["limitation", "局限", "研究方法、证据和结论的适用边界。"], ["open_question", "开放问题", "尚未解决的问题及后续研究方向。"],
].map(([id = "", title = "", question = ""]) => ({ id, title, question, claimIds: [] }));
