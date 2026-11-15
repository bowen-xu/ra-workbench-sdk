import {
  AI_CANDIDATE_SCHEMA_VERSION,
  AiSchemaError,
  assertOnlyKeys,
  expectArray,
  expectEnum,
  expectRecord,
  expectRequiredString,
  type AiCandidateDecodeContext,
} from "./schemaSupport";

export const PAPER_CONCEPT_FUNCTIONS = ["foundational", "prerequisite", "focal"] as const;
export const PAPER_CONCEPT_NOVELTY_STATUSES = [
  "pre_existing", "adapted_by_paper", "introduced_by_paper", "unclear",
] as const;
export const PAPER_CONCEPT_EXPLANATION_STATUSES = [
  "explained_in_paper", "mentioned_only", "insufficient_evidence",
] as const;
export const PAPER_CONCEPT_SURFACE_RELATIONS = [
  "preferred", "alias", "translation", "abbreviation", "variant",
] as const;
export const PAPER_CONCEPT_RELATION_KINDS = [
  "depends_on", "builds_on", "extends", "redefines", "contrasts_with", "part_of",
] as const;

export type PaperConceptFunction = (typeof PAPER_CONCEPT_FUNCTIONS)[number];
export type PaperConceptNoveltyStatus = (typeof PAPER_CONCEPT_NOVELTY_STATUSES)[number];
export type PaperConceptExplanationStatus = (typeof PAPER_CONCEPT_EXPLANATION_STATUSES)[number];
export type PaperConceptSurfaceRelation = (typeof PAPER_CONCEPT_SURFACE_RELATIONS)[number];
export type PaperConceptRelationKind = (typeof PAPER_CONCEPT_RELATION_KINDS)[number];

export interface PaperConceptSurfaceFormV1 {
  readonly text: string;
  readonly language?: string;
  readonly relationKind: PaperConceptSurfaceRelation;
  readonly evidenceItemIds: readonly string[];
}

export interface PaperDefinitionCandidateV1 {
  readonly id: string;
  readonly statement: string;
  readonly scopeNote: string;
  readonly evidenceItemIds: readonly string[];
}

export interface PaperReferenceMentionV1 {
  readonly citationText: string;
  readonly citedKey?: string;
  readonly evidenceItemIds: readonly string[];
}

export interface PaperConceptCandidateV1 {
  readonly id: string;
  readonly preferredTerm: string;
  readonly surfaceForms: readonly PaperConceptSurfaceFormV1[];
  readonly paperFunction: PaperConceptFunction;
  readonly noveltyStatus: PaperConceptNoveltyStatus;
  readonly explanationStatus: PaperConceptExplanationStatus;
  readonly explanation: string;
  readonly disambiguation: string;
  readonly roleRationale: string;
  readonly noveltyRationale: string;
  readonly definitionClaims: readonly PaperDefinitionCandidateV1[];
  readonly evidenceItemIds: readonly string[];
  readonly referenceMentions: readonly PaperReferenceMentionV1[];
}

export interface PaperConceptRelationCandidateV1 {
  readonly id: string;
  readonly subjectConceptCandidateId: string;
  readonly predicateKind: PaperConceptRelationKind;
  readonly objectConceptCandidateId: string;
  readonly scopeNote: string;
  readonly evidenceItemIds: readonly string[];
}

export interface PaperConceptOmissionV1 {
  readonly term: string;
  readonly reason: "not_key" | "insufficient_context" | "reference_only";
  readonly evidenceItemIds: readonly string[];
}

export interface PaperConceptMapCandidateV1 {
  readonly kind: "paper_concept_map_v1";
  readonly schemaVersion: 1;
  readonly concepts: readonly PaperConceptCandidateV1[];
  readonly relations: readonly PaperConceptRelationCandidateV1[];
  readonly omissions: readonly PaperConceptOmissionV1[];
}

export function decodePaperConceptMapCandidate(
  payload: Record<string, unknown>,
  context: AiCandidateDecodeContext,
): PaperConceptMapCandidateV1 | undefined {
  if (payload.kind !== "paper_concept_map_v1") return undefined;
  assertOnlyKeys(payload, ["kind", "schemaVersion", "concepts", "relations", "omissions"], "$");
  const concepts = expectArray(payload.concepts, "$.concepts");
  if (concepts.length < 1 || concepts.length > 24) {
    throw new AiSchemaError("limit_exceeded", "$.concepts", "concept count must be 1 to 24");
  }
  const conceptIds = new Set<string>();
  const definitionIds = new Set<string>();
  const decodedConcepts = concepts.map((value, index) => decodeConcept(
    value, `$.concepts[${index}]`, context, conceptIds, definitionIds,
  ));
  const relationIds = new Set<string>();
  const relations = decodeBoundedArray(payload.relations, "$.relations", 48).map((value, index) =>
    decodeRelation(value, `$.relations[${index}]`, context, conceptIds, relationIds));
  const omissions = decodeBoundedArray(payload.omissions, "$.omissions", 48).map((value, index) =>
    decodeOmission(value, `$.omissions[${index}]`, context));
  return {
    kind: "paper_concept_map_v1",
    schemaVersion: AI_CANDIDATE_SCHEMA_VERSION,
    concepts: decodedConcepts,
    relations,
    omissions,
  };
}

function decodeConcept(
  input: unknown,
  path: string,
  context: AiCandidateDecodeContext,
  conceptIds: Set<string>,
  definitionIds: Set<string>,
): PaperConceptCandidateV1 {
  const value = expectRecord(input, path, "paper concept");
  assertOnlyKeys(value, ["id", "preferredTerm", "surfaceForms", "paperFunction", "noveltyStatus",
    "explanationStatus", "explanation", "disambiguation", "roleRationale", "noveltyRationale",
    "definitionClaims", "evidenceItemIds", "referenceMentions"], path);
  const id = decodeLocalId(value.id, `${path}.id`, conceptIds);
  const preferredTerm = expectRequiredString(value, "preferredTerm", path, 240);
  const surfaceForms = decodeBoundedArray(value.surfaceForms, `${path}.surfaceForms`, 24)
    .map((item, index) => decodeSurfaceForm(item, `${path}.surfaceForms[${index}]`, context));
  if (surfaceForms.length === 0) {
    throw new AiSchemaError("invalid_value", `${path}.surfaceForms`, "at least one surface form is required");
  }
  const matchingPreferred = surfaceForms.filter((form) =>
    form.relationKind === "preferred" && form.text === preferredTerm);
  if (matchingPreferred.length !== 1) {
    throw new AiSchemaError("invalid_value", `${path}.surfaceForms`,
      "preferredTerm must have exactly one preferred surface form");
  }
  const surfaceKeys = new Set<string>();
  for (const form of surfaceForms) {
    const key = `${form.text}\u0000${form.language ?? ""}\u0000${form.relationKind}`;
    if (surfaceKeys.has(key)) {
      throw new AiSchemaError("duplicate_id", `${path}.surfaceForms`, "duplicate surface form");
    }
    surfaceKeys.add(key);
  }
  const noveltyStatus = expectEnum(value.noveltyStatus, PAPER_CONCEPT_NOVELTY_STATUSES,
    `${path}.noveltyStatus`);
  const explanationStatus = expectEnum(value.explanationStatus, PAPER_CONCEPT_EXPLANATION_STATUSES,
    `${path}.explanationStatus`);
  const explanation = expectPossiblyEmptyString(value.explanation, `${path}.explanation`, 4_000);
  const noveltyRationale = expectPossiblyEmptyString(
    value.noveltyRationale, `${path}.noveltyRationale`, 2_000,
  );
  const evidenceItemIds = decodeEvidenceIds(value.evidenceItemIds, `${path}.evidenceItemIds`, context, 16);
  const definitionClaims = decodeBoundedArray(value.definitionClaims, `${path}.definitionClaims`, 12)
    .map((item, index) => decodeDefinition(
      item, `${path}.definitionClaims[${index}]`, context, definitionIds,
    ));
  const referenceMentions = decodeBoundedArray(value.referenceMentions, `${path}.referenceMentions`, 16)
    .map((item, index) => decodeReferenceMention(
      item, `${path}.referenceMentions[${index}]`, context,
    ));
  if (explanationStatus === "explained_in_paper" && (explanation.length === 0 || evidenceItemIds.length === 0)) {
    throw new AiSchemaError("evidence_requirement_not_met", path,
      "explained concepts require an explanation and direct evidence");
  }
  if (explanationStatus === "mentioned_only" && referenceMentions.length === 0) {
    throw new AiSchemaError("evidence_requirement_not_met", `${path}.referenceMentions`,
      "mentioned-only concepts require a reference mention");
  }
  if (noveltyStatus === "introduced_by_paper"
    && (noveltyRationale.length === 0 || evidenceItemIds.length === 0)) {
    throw new AiSchemaError("evidence_requirement_not_met", path,
      "introduced concepts require a rationale and direct evidence");
  }
  return {
    id,
    preferredTerm,
    surfaceForms,
    paperFunction: expectEnum(value.paperFunction, PAPER_CONCEPT_FUNCTIONS, `${path}.paperFunction`),
    noveltyStatus,
    explanationStatus,
    explanation,
    disambiguation: expectPossiblyEmptyString(value.disambiguation, `${path}.disambiguation`, 2_000),
    roleRationale: expectRequiredString(value, "roleRationale", path, 2_000),
    noveltyRationale,
    definitionClaims,
    evidenceItemIds,
    referenceMentions,
  };
}

function decodeSurfaceForm(
  input: unknown, path: string, context: AiCandidateDecodeContext,
): PaperConceptSurfaceFormV1 {
  const value = expectRecord(input, path, "surface form");
  assertOnlyKeys(value, ["text", "language", "relationKind", "evidenceItemIds"], path);
  const language = value.language === undefined
    ? undefined : expectRequiredString({ language: value.language }, "language", path, 32);
  return {
    text: expectRequiredString(value, "text", path, 240),
    ...(language === undefined ? {} : { language }),
    relationKind: expectEnum(value.relationKind, PAPER_CONCEPT_SURFACE_RELATIONS,
      `${path}.relationKind`),
    evidenceItemIds: decodeEvidenceIds(value.evidenceItemIds, `${path}.evidenceItemIds`, context, 8),
  };
}

function decodeDefinition(
  input: unknown, path: string, context: AiCandidateDecodeContext, ids: Set<string>,
): PaperDefinitionCandidateV1 {
  const value = expectRecord(input, path, "definition claim");
  assertOnlyKeys(value, ["id", "statement", "scopeNote", "evidenceItemIds"], path);
  const evidenceItemIds = decodeEvidenceIds(value.evidenceItemIds, `${path}.evidenceItemIds`, context, 8);
  if (evidenceItemIds.length === 0) {
    throw new AiSchemaError("evidence_requirement_not_met", `${path}.evidenceItemIds`,
      "definition claims require evidence");
  }
  return {
    id: decodeLocalId(value.id, `${path}.id`, ids),
    statement: expectRequiredString(value, "statement", path, 4_000),
    scopeNote: expectPossiblyEmptyString(value.scopeNote, `${path}.scopeNote`, 2_000),
    evidenceItemIds,
  };
}

function decodeReferenceMention(
  input: unknown, path: string, context: AiCandidateDecodeContext,
): PaperReferenceMentionV1 {
  const value = expectRecord(input, path, "reference mention");
  assertOnlyKeys(value, ["citationText", "citedKey", "evidenceItemIds"], path);
  const citedKey = value.citedKey === undefined
    ? undefined : expectRequiredString({ citedKey: value.citedKey }, "citedKey", path, 240);
  const evidenceItemIds = decodeEvidenceIds(value.evidenceItemIds, `${path}.evidenceItemIds`, context, 8);
  if (evidenceItemIds.length === 0) {
    throw new AiSchemaError("evidence_requirement_not_met", `${path}.evidenceItemIds`,
      "reference mentions require evidence");
  }
  return {
    citationText: expectRequiredString(value, "citationText", path, 1_000),
    ...(citedKey === undefined ? {} : { citedKey }),
    evidenceItemIds,
  };
}

function decodeRelation(
  input: unknown,
  path: string,
  context: AiCandidateDecodeContext,
  conceptIds: ReadonlySet<string>,
  relationIds: Set<string>,
): PaperConceptRelationCandidateV1 {
  const value = expectRecord(input, path, "concept relation");
  assertOnlyKeys(value, ["id", "subjectConceptCandidateId", "predicateKind",
    "objectConceptCandidateId", "scopeNote", "evidenceItemIds"], path);
  const subjectConceptCandidateId = expectRequiredString(value, "subjectConceptCandidateId", path, 80);
  const objectConceptCandidateId = expectRequiredString(value, "objectConceptCandidateId", path, 80);
  if (!conceptIds.has(subjectConceptCandidateId) || !conceptIds.has(objectConceptCandidateId)) {
    throw new AiSchemaError("invalid_value", path, "relation endpoint is not a concept in this payload");
  }
  if (subjectConceptCandidateId === objectConceptCandidateId) {
    throw new AiSchemaError("invalid_value", path, "concept relation cannot be a self-loop");
  }
  const evidenceItemIds = decodeEvidenceIds(value.evidenceItemIds, `${path}.evidenceItemIds`, context, 12);
  if (evidenceItemIds.length === 0) {
    throw new AiSchemaError("evidence_requirement_not_met", `${path}.evidenceItemIds`,
      "concept relations require evidence");
  }
  return {
    id: decodeLocalId(value.id, `${path}.id`, relationIds),
    subjectConceptCandidateId,
    predicateKind: expectEnum(value.predicateKind, PAPER_CONCEPT_RELATION_KINDS,
      `${path}.predicateKind`),
    objectConceptCandidateId,
    scopeNote: expectPossiblyEmptyString(value.scopeNote, `${path}.scopeNote`, 2_000),
    evidenceItemIds,
  };
}

function decodeOmission(
  input: unknown, path: string, context: AiCandidateDecodeContext,
): PaperConceptOmissionV1 {
  const value = expectRecord(input, path, "concept omission");
  assertOnlyKeys(value, ["term", "reason", "evidenceItemIds"], path);
  return {
    term: expectRequiredString(value, "term", path, 240),
    reason: expectEnum(value.reason, ["not_key", "insufficient_context", "reference_only"] as const,
      `${path}.reason`),
    evidenceItemIds: decodeEvidenceIds(value.evidenceItemIds, `${path}.evidenceItemIds`, context, 8),
  };
}

function decodeLocalId(input: unknown, path: string, seen: Set<string>): string {
  if (typeof input !== "string" || !/^[a-z][a-z0-9_-]{0,79}$/.test(input)) {
    throw new AiSchemaError("invalid_value", path, "must be a stable local ID");
  }
  if (seen.has(input)) throw new AiSchemaError("duplicate_id", path, `duplicate local ID ${input}`);
  seen.add(input);
  return input;
}

function decodeEvidenceIds(
  input: unknown,
  path: string,
  context: AiCandidateDecodeContext,
  maximum: number,
): readonly string[] {
  const values = decodeBoundedArray(input, path, maximum);
  const seen = new Set<string>();
  return values.map((value, index) => {
    if (typeof value !== "string" || value.length === 0 || value.length > 80) {
      throw new AiSchemaError("invalid_type", `${path}[${index}]`, "must be a context item ID");
    }
    if (!context.allowedEvidenceItemIds.has(value)) {
      throw new AiSchemaError("unknown_evidence_id", `${path}[${index}]`, `unknown evidence ID ${value}`);
    }
    if (seen.has(value)) throw new AiSchemaError("duplicate_id", `${path}[${index}]`, "duplicate evidence ID");
    seen.add(value);
    return value;
  });
}

function decodeBoundedArray(input: unknown, path: string, maximum: number): readonly unknown[] {
  const values = expectArray(input, path);
  if (values.length > maximum) {
    throw new AiSchemaError("limit_exceeded", path, `item count exceeds ${maximum}`);
  }
  return values;
}

function expectPossiblyEmptyString(input: unknown, path: string, maximum: number): string {
  if (typeof input !== "string") throw new AiSchemaError("invalid_type", path, "must be a string");
  const value = input.trim();
  if (Array.from(value).length > maximum) {
    throw new AiSchemaError("limit_exceeded", path, `character count exceeds ${maximum}`);
  }
  return value;
}
