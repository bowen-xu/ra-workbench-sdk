import {
  AI_CANDIDATE_SCHEMA_VERSION,
  AiSchemaError,
  assertOnlyKeys,
  expectArray,
  expectEnum,
  expectRecord,
  expectRequiredInteger,
  expectRequiredString,
  expectString,
  type AiCandidateDecodeContext,
} from "./schemaSupport";

export const AI_RESEARCH_CANDIDATE_KINDS = [
  "reference_record_candidate_v1",
  "derived_research_view_v1",
] as const;

export type AiResearchCandidateKind = (typeof AI_RESEARCH_CANDIDATE_KINDS)[number];
export type AiReferenceFieldName = "title" | "authors" | "year" | "doi";
export type AiDerivedResearchViewKind =
  | "taxonomy"
  | "historical_context"
  | "gap_hypothesis"
  | "innovation_hypothesis";

export interface AiReferenceFieldCandidateV1 {
  readonly name: AiReferenceFieldName;
  readonly value: string;
  readonly evidenceItemIds: readonly string[];
}

export interface AiReferenceRecordCandidateV1 {
  readonly kind: "reference_record_candidate_v1";
  readonly schemaVersion: 1;
  readonly rawText: string;
  readonly evidenceItemIds: readonly string[];
  readonly fields: readonly AiReferenceFieldCandidateV1[];
  readonly uncertainties: readonly string[];
}

export interface AiDerivedResearchViewItemV1 {
  readonly id: string;
  readonly text: string;
  readonly epistemicRole: "synthesis" | "inference" | "hypothesis";
  readonly evidenceItemIds: readonly string[];
  readonly hasConflict: boolean;
}

export interface AiDerivedResearchViewCandidateV1 {
  readonly kind: "derived_research_view_v1";
  readonly schemaVersion: 1;
  readonly viewKind: AiDerivedResearchViewKind;
  readonly title: string;
  readonly scopeNote: string;
  readonly items: readonly AiDerivedResearchViewItemV1[];
}

export type AiResearchCandidatePayloadV1 =
  | AiReferenceRecordCandidateV1
  | AiDerivedResearchViewCandidateV1;

export function decodeAiResearchCandidatePayload(
  payload: Record<string, unknown>,
  context: AiCandidateDecodeContext,
): AiResearchCandidatePayloadV1 | undefined {
  if (payload.kind === "reference_record_candidate_v1") {
    return decodeReferenceRecord(payload, context.allowedEvidenceItemIds);
  }
  if (payload.kind === "derived_research_view_v1") {
    return decodeDerivedView(payload, context.allowedEvidenceItemIds);
  }
  return undefined;
}

function decodeReferenceRecord(
  payload: Record<string, unknown>,
  allowedEvidenceIds: ReadonlySet<string>,
): AiReferenceRecordCandidateV1 {
  assertHeader(payload, "reference_record_candidate_v1");
  assertOnlyKeys(
    payload,
    ["kind", "schemaVersion", "rawText", "evidenceItemIds", "fields", "uncertainties"],
    "$",
  );
  const rawText = expectRequiredString(payload, "rawText", "$", 8_000);
  const evidenceItemIds = decodeEvidenceIds(
    payload.evidenceItemIds,
    "$.evidenceItemIds",
    allowedEvidenceIds,
    1,
    4,
  );
  const values = expectArray(payload.fields, "$.fields");
  if (values.length > 4) {
    throw new AiSchemaError("limit_exceeded", "$.fields", "reference field count exceeds 4");
  }
  const seenNames = new Set<AiReferenceFieldName>();
  const fields = values.map((value, index) => {
    const path = `$.fields[${index}]`;
    const field = expectRecord(value, path, "reference field");
    assertOnlyKeys(field, ["name", "value", "evidenceItemIds"], path);
    const name = expectEnum(
      field.name,
      ["title", "authors", "year", "doi"] as const,
      `${path}.name`,
    );
    if (seenNames.has(name)) {
      throw new AiSchemaError("duplicate_id", `${path}.name`, `duplicate field ${name}`);
    }
    seenNames.add(name);
    return {
      name,
      value: expectRequiredString(field, "value", path, 2_000),
      evidenceItemIds: decodeEvidenceIds(
        field.evidenceItemIds,
        `${path}.evidenceItemIds`,
        allowedEvidenceIds,
        1,
        4,
      ),
    };
  });
  const uncertainties = decodeStrings(payload.uncertainties, "$.uncertainties", 12, 1_000);
  return {
    kind: "reference_record_candidate_v1",
    schemaVersion: AI_CANDIDATE_SCHEMA_VERSION,
    rawText,
    evidenceItemIds,
    fields,
    uncertainties,
  };
}

function decodeDerivedView(
  payload: Record<string, unknown>,
  allowedEvidenceIds: ReadonlySet<string>,
): AiDerivedResearchViewCandidateV1 {
  assertHeader(payload, "derived_research_view_v1");
  assertOnlyKeys(payload, ["kind", "schemaVersion", "viewKind", "title", "scopeNote", "items"], "$" );
  const viewKind = expectEnum(
    payload.viewKind,
    ["taxonomy", "historical_context", "gap_hypothesis", "innovation_hypothesis"] as const,
    "$.viewKind",
  );
  const values = expectArray(payload.items, "$.items");
  if (values.length === 0 || values.length > 24) {
    throw new AiSchemaError("limit_exceeded", "$.items", "derived item count must be 1 to 24");
  }
  const seenIds = new Set<string>();
  const items = values.map((value, index) => {
    const path = `$.items[${index}]`;
    const item = expectRecord(value, path, "derived view item");
    assertOnlyKeys(item, ["id", "text", "epistemicRole", "evidenceItemIds", "hasConflict"], path);
    const id = expectRequiredString(item, "id", path, 80);
    if (!/^[a-z][a-z0-9_-]*$/.test(id) || seenIds.has(id)) {
      throw new AiSchemaError("duplicate_id", `${path}.id`, "derived item ID is invalid or duplicated");
    }
    seenIds.add(id);
    const epistemicRole = expectEnum(
      item.epistemicRole,
      ["synthesis", "inference", "hypothesis"] as const,
      `${path}.epistemicRole`,
    );
    if (
      (viewKind === "gap_hypothesis" || viewKind === "innovation_hypothesis")
      && epistemicRole !== "hypothesis"
    ) {
      throw new AiSchemaError(
        "invalid_value",
        `${path}.epistemicRole`,
        "gap and innovation views must remain hypotheses",
      );
    }
    const hasConflict = item.hasConflict;
    if (typeof hasConflict !== "boolean") {
      throw new AiSchemaError("invalid_type", `${path}.hasConflict`, "must be a boolean");
    }
    return {
      id,
      text: expectRequiredString(item, "text", path, 4_000),
      epistemicRole,
      evidenceItemIds: decodeEvidenceIds(
        item.evidenceItemIds,
        `${path}.evidenceItemIds`,
        allowedEvidenceIds,
        epistemicRole === "synthesis" ? 2 : 1,
        16,
      ),
      hasConflict,
    };
  });
  return {
    kind: "derived_research_view_v1",
    schemaVersion: AI_CANDIDATE_SCHEMA_VERSION,
    viewKind,
    title: expectRequiredString(payload, "title", "$", 240),
    scopeNote: expectRequiredString(payload, "scopeNote", "$", 4_000),
    items,
  };
}

function assertHeader(payload: Record<string, unknown>, expectedKind: string): void {
  const version = expectRequiredInteger(payload, "schemaVersion", "$", 1, Number.MAX_SAFE_INTEGER);
  if (version !== AI_CANDIDATE_SCHEMA_VERSION || payload.kind !== expectedKind) {
    throw new AiSchemaError("unknown_schema_version", "$.schemaVersion", "unsupported candidate schema");
  }
}

function decodeEvidenceIds(
  input: unknown,
  path: string,
  allowedEvidenceIds: ReadonlySet<string>,
  minimum: number,
  maximum: number,
): readonly string[] {
  const values = expectArray(input, path);
  if (values.length < minimum || values.length > maximum) {
    throw new AiSchemaError("evidence_requirement_not_met", path, `requires ${minimum} to ${maximum} evidence IDs`);
  }
  const seen = new Set<string>();
  return values.map((value, index) => {
    const id = expectString(value, `${path}[${index}]`, 80);
    if (seen.has(id)) throw new AiSchemaError("duplicate_id", `${path}[${index}]`, `duplicate evidence ID ${id}`);
    if (!allowedEvidenceIds.has(id)) {
      throw new AiSchemaError("unknown_evidence_id", `${path}[${index}]`, `evidence ID ${id} is outside the frozen bundle`);
    }
    seen.add(id);
    return id;
  });
}

function decodeStrings(
  input: unknown,
  path: string,
  maximumItems: number,
  maximumCharacters: number,
): readonly string[] {
  const values = expectArray(input, path);
  if (values.length > maximumItems) {
    throw new AiSchemaError("limit_exceeded", path, `item count exceeds ${maximumItems}`);
  }
  return values.map((value, index) => expectString(value, `${path}[${index}]`, maximumCharacters));
}
