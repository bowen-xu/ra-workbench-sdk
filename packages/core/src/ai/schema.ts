import {
  AI_CANDIDATE_SCHEMA_VERSION,
  AI_EPISTEMIC_ROLES,
  AiSchemaError,
  assertOnlyKeys,
  DEFAULT_AI_CANDIDATE_DECODE_LIMITS,
  expectArray,
  expectEnum,
  expectRecord,
  expectRequiredInteger,
  expectRequiredString,
  expectString,
  type AiCandidateDecodeContext,
  type AiCandidateDecodeLimits,
  type AiEpistemicRole,
} from "./schemaSupport";
import {
  decodeAiKnowledgeCandidatePayload,
  type AiKnowledgeCandidatePayloadV1,
} from "./knowledgeCandidateSchema";
import {
  decodeAiResearchCandidatePayload,
  type AiResearchCandidatePayloadV1,
} from "./researchCandidateSchema";
import {
  decodePaperConceptMapCandidate,
  type PaperConceptMapCandidateV1,
} from "./paperConceptMapSchema";

import { decodePaperTemplateSnapshot, type PaperTemplateSnapshot } from "./paperTemplate";
import type { PortraitEvidence } from "./paperPortrait";
import { decodePaperPortrait, type PaperPortraitCandidateV1 } from "./paperPortrait";

export {
  AI_CANDIDATE_SCHEMA_VERSION,
  AI_EPISTEMIC_ROLES,
  AiSchemaError,
} from "./schemaSupport";
export type {
  AiCandidateDecodeContext,
  AiCandidateDecodeLimits,
  AiEpistemicRole,
  AiSchemaErrorCode,
} from "./schemaSupport";

export const GENERIC_OVERVIEW_FIELDS = [
  "research_question",
  "approach",
  "key_result",
  "conclusion",
  "limitation",
  "open_question",
] as const;

export type GenericOverviewField = (typeof GENERIC_OVERVIEW_FIELDS)[number];

export const PROFILED_OVERVIEW_FIELDS = [
  ...GENERIC_OVERVIEW_FIELDS,
  "argument",
  "objection",
  "response",
] as const;

export type ProfiledOverviewField = (typeof PROFILED_OVERVIEW_FIELDS)[number];
export type OverviewFieldId = string;
export type OverviewFieldStatus = "filled" | "not_found" | "partial";

export interface AiReadingProfileRefV1 {
  readonly profileId: string;
  readonly profileVersion: number;
}

const APPROVED_PROFILE_FIELDS: Readonly<Record<string, readonly ProfiledOverviewField[]>> = {
  "generic_overview:1": GENERIC_OVERVIEW_FIELDS,
  "technical_empirical:1": GENERIC_OVERVIEW_FIELDS,
  "philosophical_conceptual:1": [
    "research_question", "argument", "objection", "response", "conclusion", "open_question",
  ],
};

export interface AiAtomicStatementV1 {
  readonly id: string;
  readonly text: string;
  readonly epistemicRole: AiEpistemicRole;
  readonly evidenceItemIds: readonly string[];
  readonly evidenceQuotes?: readonly PortraitEvidence[];
}

export interface SelectionExplanationCandidateV1 {
  readonly kind: "selection_explanation_v1";
  readonly schemaVersion: 1;
  readonly statements: readonly AiAtomicStatementV1[];
  readonly uncertainties: readonly string[];
}

export interface PaperOverviewFieldV1 {
  readonly field: OverviewFieldId;
  readonly status: OverviewFieldStatus;
  readonly statements: readonly AiAtomicStatementV1[];
}

export interface PaperOverviewUnitCandidateV1 {
  readonly kind: "paper_overview_unit_v1";
  readonly schemaVersion: 1;
  readonly profileId: "generic_overview_v1" | "reviewed_profile_composition_v1" | "paper_template_v1";
  readonly profileRefs?: readonly AiReadingProfileRefV1[];
  readonly paperTemplate?: PaperTemplateSnapshot;
  readonly fields: readonly PaperOverviewFieldV1[];
}

export type AiCandidatePayloadV1 =
  | PaperPortraitCandidateV1
  | SelectionExplanationCandidateV1
  | PaperOverviewUnitCandidateV1
  | PaperConceptMapCandidateV1
  | AiKnowledgeCandidatePayloadV1
  | AiResearchCandidatePayloadV1;

export function decodeAiCandidatePayload(
  input: unknown,
  context: AiCandidateDecodeContext,
): AiCandidatePayloadV1 {
  const limits = { ...DEFAULT_AI_CANDIDATE_DECODE_LIMITS, ...context.limits };
  const payload = expectRecord(input, "$", "candidate payload");
  const kind = expectRequiredString(payload, "kind", "$", 80);
  const schemaVersion = expectRequiredInteger(
    payload,
    "schemaVersion",
    "$",
    1,
    Number.MAX_SAFE_INTEGER,
  );
  if (schemaVersion !== AI_CANDIDATE_SCHEMA_VERSION) {
    throw new AiSchemaError(
      "unknown_schema_version",
      "$.schemaVersion",
      `unsupported schema version ${schemaVersion}`,
    );
  }

  if (kind === "paper_portrait_v1") return decodePaperPortrait(payload, context);
  if (kind === "selection_explanation_v1") {
    return decodeSelectionExplanation(payload, context.allowedEvidenceItemIds, limits);
  }
  if (kind === "paper_overview_unit_v1") {
    return decodePaperOverview(payload, context.allowedEvidenceItemIds, limits);
  }
  const paperConceptMap = decodePaperConceptMapCandidate(payload, context);
  if (paperConceptMap !== undefined) return paperConceptMap;
  const knowledgeCandidate = decodeAiKnowledgeCandidatePayload(payload, context);
  if (knowledgeCandidate !== undefined) return knowledgeCandidate;
  const researchCandidate = decodeAiResearchCandidatePayload(payload, context);
  if (researchCandidate !== undefined) return researchCandidate;
  throw new AiSchemaError("unknown_kind", "$.kind", `unsupported candidate kind ${kind}`);
}

function decodeSelectionExplanation(
  payload: Record<string, unknown>,
  allowedEvidenceItemIds: ReadonlySet<string>,
  limits: AiCandidateDecodeLimits,
): SelectionExplanationCandidateV1 {
  assertOnlyKeys(payload, ["kind", "schemaVersion", "statements", "uncertainties"], "$");
  const seenStatementIds = new Set<string>();
  const statements = decodeStatements(
    payload.statements,
    "$.statements",
    allowedEvidenceItemIds,
    seenStatementIds,
    limits,
  );
  if (statements.length === 0) {
    throw new AiSchemaError("invalid_value", "$.statements", "at least one statement is required");
  }
  const uncertainties = decodeBoundedStrings(
    payload.uncertainties,
    "$.uncertainties",
    limits.maxUncertainties,
    limits.maxUncertaintyCharacters,
  );
  return {
    kind: "selection_explanation_v1",
    schemaVersion: AI_CANDIDATE_SCHEMA_VERSION,
    statements,
    uncertainties,
  };
}

function decodePaperOverview(
  payload: Record<string, unknown>,
  allowedEvidenceItemIds: ReadonlySet<string>,
  limits: AiCandidateDecodeLimits,
): PaperOverviewUnitCandidateV1 {
  assertOnlyKeys(payload, ["kind", "schemaVersion", "profileId", "profileRefs", "paperTemplate", "fields"], "$");
  const profileId = expectRequiredString(payload, "profileId", "$", 80);
  if (profileId !== "generic_overview_v1" && profileId !== "reviewed_profile_composition_v1" && profileId !== "paper_template_v1") {
    throw new AiSchemaError("invalid_value", "$.profileId", `unsupported profile ${profileId}`);
  }
  const profileRefs = profileId === "reviewed_profile_composition_v1"
    ? decodeProfileRefs(payload.profileRefs)
    : undefined;
  if (profileId === "generic_overview_v1" && payload.profileRefs !== undefined) {
    throw new AiSchemaError("unknown_field", "$.profileRefs", "legacy generic profile has no refs");
  }
  const paperTemplate = profileId === "paper_template_v1" ? decodePaperTemplateSnapshot(payload.paperTemplate) : undefined;
  if (profileId !== "paper_template_v1" && payload.paperTemplate !== undefined || profileId === "paper_template_v1" && payload.profileRefs !== undefined) throw new AiSchemaError("invalid_value", "$", "incompatible template/profile references");
  const rawFields = expectArray(payload.fields, "$.fields");
  const expectedFields = profileId === "generic_overview_v1"
    ? GENERIC_OVERVIEW_FIELDS : paperTemplate?.fields.map(field => field.id) ?? fieldsForProfileRefs(profileRefs ?? []);
  if (rawFields.length !== expectedFields.length) {
    throw new AiSchemaError(
      "invalid_value",
      "$.fields",
      "overview field count does not match the selected profile mode",
    );
  }

  const seenFields = new Set<string>();
  const seenStatementIds = new Set<string>();
  const fields = rawFields.map((rawField, index) => {
    const path = `$.fields[${index}]`;
    const fieldRecord = expectRecord(rawField, path, "overview field");
    assertOnlyKeys(fieldRecord, ["field", "status", "statements"], path);
    const field = expectEnum(
      fieldRecord.field,
      expectedFields,
      `${path}.field`,
    );
    if (seenFields.has(field)) {
      throw new AiSchemaError("duplicate_id", `${path}.field`, `duplicate overview field ${field}`);
    }
    seenFields.add(field);
    const status = expectEnum(
      fieldRecord.status,
      ["filled", "not_found", "partial"] as const,
      `${path}.status`,
    );
    const statements = decodeStatements(
      fieldRecord.statements,
      `${path}.statements`,
      allowedEvidenceItemIds,
      seenStatementIds,
      limits,
      paperTemplate !== undefined,
    );
    if (status === "not_found" && statements.length !== 0) {
      throw new AiSchemaError(
        "invalid_value",
        `${path}.statements`,
        "not_found fields cannot contain statements",
      );
    }
    if (status !== "not_found" && statements.length === 0) {
      throw new AiSchemaError(
        "invalid_value",
        `${path}.statements`,
        `${status} fields require at least one statement`,
      );
    }
    if (paperTemplate !== undefined) {
      if (field !== expectedFields[index]) throw new AiSchemaError("invalid_value", path, "template field order changed");
      for (const statement of statements) {
        const keys = new Set(statement.evidenceQuotes?.map(source => source.evidenceItemId) ?? []);
        if (keys.size === 0 || statement.evidenceItemIds.length !== keys.size || statement.evidenceItemIds.some(id => !keys.has(id))) throw new AiSchemaError("evidence_requirement_not_met", path, "every template statement needs literal quotes for all cited sources");
      }
    }
    return { field, status, statements };
  });

  if (seenStatementIds.size > limits.maxStatements) {
    throw new AiSchemaError(
      "limit_exceeded",
      "$.fields",
      `total statement count exceeds ${limits.maxStatements}`,
    );
  }

  for (const expectedField of expectedFields) {
    if (!seenFields.has(expectedField)) {
      throw new AiSchemaError("missing_field", "$.fields", `missing overview field ${expectedField}`);
    }
  }
  return {
    kind: "paper_overview_unit_v1",
    schemaVersion: AI_CANDIDATE_SCHEMA_VERSION,
    profileId,
    ...(profileRefs === undefined ? {} : { profileRefs }),
    ...(paperTemplate === undefined ? {} : { paperTemplate }),
    fields,
  };
}

function fieldsForProfileRefs(
  refs: readonly AiReadingProfileRefV1[],
): readonly ProfiledOverviewField[] {
  const requested = new Set<ProfiledOverviewField>();
  for (const reference of refs) {
    const key = `${reference.profileId}:${reference.profileVersion}`;
    const fields = APPROVED_PROFILE_FIELDS[key];
    if (fields === undefined) {
      throw new AiSchemaError("invalid_value", "$.profileRefs", `unsupported profile ${key}`);
    }
    fields.forEach((field) => requested.add(field));
  }
  return PROFILED_OVERVIEW_FIELDS.filter((field) => requested.has(field));
}

function decodeProfileRefs(input: unknown): readonly AiReadingProfileRefV1[] {
  const values = expectArray(input, "$.profileRefs");
  if (values.length === 0 || values.length > 3) {
    throw new AiSchemaError("limit_exceeded", "$.profileRefs", "profile count must be 1 to 3");
  }
  const seen = new Set<string>();
  return values.map((value, index) => {
    const path = `$.profileRefs[${index}]`;
    const reference = expectRecord(value, path, "reading profile reference");
    assertOnlyKeys(reference, ["profileId", "profileVersion"], path);
    const profileId = expectRequiredString(reference, "profileId", path, 120);
    const profileVersion = expectRequiredInteger(reference, "profileVersion", path, 1, 1_000_000);
    const key = `${profileId}:${profileVersion}`;
    if (seen.has(key)) {
      throw new AiSchemaError("duplicate_id", path, `duplicate profile ${key}`);
    }
    seen.add(key);
    return { profileId, profileVersion };
  });
}

function decodeStatements(
  input: unknown,
  path: string,
  allowedEvidenceItemIds: ReadonlySet<string>,
  seenStatementIds: Set<string>,
  limits: AiCandidateDecodeLimits,
  templateQuotes = false,
): readonly AiAtomicStatementV1[] {
  const values = expectArray(input, path);
  if (values.length > limits.maxStatements) {
    throw new AiSchemaError(
      "limit_exceeded",
      path,
      `statement count exceeds ${limits.maxStatements}`,
    );
  }
  return values.map((value, index) => {
    const statementPath = `${path}[${index}]`;
    const statement = expectRecord(value, statementPath, "atomic statement");
    assertOnlyKeys(statement, ["id", "text", "epistemicRole", "evidenceItemIds", "evidenceQuotes"], statementPath);
    const id = expectRequiredString(statement, "id", statementPath, 64);
    if (!/^[a-z][a-z0-9_-]*$/.test(id)) {
      throw new AiSchemaError("invalid_value", `${statementPath}.id`, "invalid statement ID");
    }
    if (seenStatementIds.has(id)) {
      throw new AiSchemaError("duplicate_id", `${statementPath}.id`, `duplicate statement ID ${id}`);
    }
    seenStatementIds.add(id);
    const text = expectRequiredString(
      statement,
      "text",
      statementPath,
      limits.maxStatementCharacters,
    );
    const epistemicRole = expectEnum(
      statement.epistemicRole,
      AI_EPISTEMIC_ROLES,
      `${statementPath}.epistemicRole`,
    );
    const evidenceItemIds = decodeEvidenceIds(
      statement.evidenceItemIds,
      `${statementPath}.evidenceItemIds`,
      allowedEvidenceItemIds,
      limits.maxEvidenceIdsPerStatement,
    );
    validateEvidenceRequirement(epistemicRole, evidenceItemIds, `${statementPath}.evidenceItemIds`);
    const evidenceQuotes = statement.evidenceQuotes === undefined ? undefined : expectArray(statement.evidenceQuotes, statementPath).map(raw => {
      const source = expectRecord(raw, statementPath, "evidence quote");
      assertOnlyKeys(source, ["evidenceItemId", "quote"], statementPath);
      const evidenceItemId = expectRequiredString(source, "evidenceItemId", statementPath, 80);
      if (!evidenceItemIds.includes(evidenceItemId)) throw new AiSchemaError("unknown_evidence_id", statementPath, "quote outside cited sources");
      // Frozen-source membership is checked by the persistence boundary. A valid
      // source paragraph may exceed 1200 characters; never truncate its quotation.
      return { evidenceItemId, quote: expectRequiredString(source, "quote", statementPath, templateQuotes ? Number.MAX_SAFE_INTEGER : 1200) };
    });
    if (evidenceQuotes !== undefined && (evidenceQuotes.length > 8 || new Set(evidenceQuotes.map(value => value.evidenceItemId)).size !== evidenceQuotes.length)) throw new AiSchemaError("limit_exceeded", statementPath, "one quote per cited source, at most 8");
    return { id, text, epistemicRole, evidenceItemIds, ...(evidenceQuotes === undefined ? {} : { evidenceQuotes }) };
  });
}

function decodeEvidenceIds(
  input: unknown,
  path: string,
  allowedEvidenceItemIds: ReadonlySet<string>,
  maxItems: number,
): readonly string[] {
  const values = expectArray(input, path);
  if (values.length > maxItems) {
    throw new AiSchemaError("limit_exceeded", path, `evidence ID count exceeds ${maxItems}`);
  }
  const seen = new Set<string>();
  return values.map((value, index) => {
    const evidenceId = expectString(value, `${path}[${index}]`, 80);
    if (seen.has(evidenceId)) {
      throw new AiSchemaError("duplicate_id", `${path}[${index}]`, `duplicate evidence ID ${evidenceId}`);
    }
    if (!allowedEvidenceItemIds.has(evidenceId)) {
      throw new AiSchemaError(
        "unknown_evidence_id",
        `${path}[${index}]`,
        `evidence ID ${evidenceId} is outside the frozen bundle`,
      );
    }
    seen.add(evidenceId);
    return evidenceId;
  });
}

function validateEvidenceRequirement(
  role: AiEpistemicRole,
  evidenceItemIds: readonly string[],
  path: string,
): void {
  const minimum = role === "synthesis" ? 2 : role === "uncertain" ? 0 : 1;
  if (evidenceItemIds.length < minimum) {
    throw new AiSchemaError(
      "evidence_requirement_not_met",
      path,
      `${role} requires at least ${minimum} evidence item(s)`,
    );
  }
}

function decodeBoundedStrings(
  input: unknown,
  path: string,
  maxItems: number,
  maxCharacters: number,
): readonly string[] {
  const values = expectArray(input, path);
  if (values.length > maxItems) {
    throw new AiSchemaError("limit_exceeded", path, `item count exceeds ${maxItems}`);
  }
  return values.map((value, index) => expectString(value, `${path}[${index}]`, maxCharacters));
}
