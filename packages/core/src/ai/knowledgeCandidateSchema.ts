import {
  RELATION_PREDICATE_KINDS,
  type RelationPredicateKind,
} from "../knowledge";
import {
  AI_CANDIDATE_SCHEMA_VERSION,
  AI_EPISTEMIC_ROLES,
  AiSchemaError,
  assertOnlyKeys,
  expectArray,
  expectEnum,
  expectOptionalString,
  expectRecord,
  expectRequiredString,
  expectString,
  type AiCandidateDecodeContext,
  type AiEpistemicRole,
} from "./schemaSupport";

interface AiGroundedSuggestionV1 {
  readonly id: string;
  readonly epistemicRole: AiEpistemicRole;
  readonly evidenceItemIds: readonly string[];
}

export interface AiConceptSuggestionV1 extends AiGroundedSuggestionV1 {
  readonly term: string;
  readonly language?: string;
  readonly explanation: string;
  readonly disambiguation?: string;
  readonly domain?: string;
  readonly tradition?: string;
  readonly period?: string;
}

export interface AiDefinitionSuggestionV1 extends AiGroundedSuggestionV1 {
  readonly term: string;
  readonly statement: string;
  readonly scopeNote?: string;
}

export interface AiRelationSuggestionV1 extends AiGroundedSuggestionV1 {
  readonly subjectTerm: string;
  readonly predicateKind: RelationPredicateKind;
  readonly objectTerm: string;
  readonly scopeNote?: string;
}

export interface AiAttentionSuggestionV1 {
  readonly id: string;
  readonly title: string;
  readonly reason: string;
  readonly priority: "high" | "medium" | "low";
  readonly evidenceItemIds: readonly string[];
}

export interface AiConceptSuggestionCandidateV1 {
  readonly kind: "concept_suggestion_v1";
  readonly schemaVersion: 1;
  readonly suggestions: readonly AiConceptSuggestionV1[];
}

export interface AiDefinitionSuggestionCandidateV1 {
  readonly kind: "definition_suggestion_v1";
  readonly schemaVersion: 1;
  readonly suggestions: readonly AiDefinitionSuggestionV1[];
}

export interface AiRelationSuggestionCandidateV1 {
  readonly kind: "relation_suggestion_v1";
  readonly schemaVersion: 1;
  readonly suggestions: readonly AiRelationSuggestionV1[];
}

export interface AiAttentionSuggestionCandidateV1 {
  readonly kind: "attention_suggestion_v1";
  readonly schemaVersion: 1;
  readonly suggestions: readonly AiAttentionSuggestionV1[];
}

export type AiKnowledgeCandidatePayloadV1 =
  | AiConceptSuggestionCandidateV1
  | AiDefinitionSuggestionCandidateV1
  | AiRelationSuggestionCandidateV1
  | AiAttentionSuggestionCandidateV1;

export const AI_SUGGESTION_CANDIDATE_KINDS = [
  "concept_suggestion_v1",
  "definition_suggestion_v1",
  "relation_suggestion_v1",
  "attention_suggestion_v1",
] as const satisfies readonly AiKnowledgeCandidatePayloadV1["kind"][];

export type AiSuggestionCandidateKind = (typeof AI_SUGGESTION_CANDIDATE_KINDS)[number];

export function decodeAiKnowledgeCandidatePayload(
  payload: Record<string, unknown>,
  context: AiCandidateDecodeContext,
): AiKnowledgeCandidatePayloadV1 | undefined {
  const kind = payload.kind;
  if (kind === "concept_suggestion_v1") {
    return { kind, schemaVersion: AI_CANDIDATE_SCHEMA_VERSION,
      suggestions: decodeSuggestions(payload, context, decodeConceptSuggestion) };
  }
  if (kind === "definition_suggestion_v1") {
    return { kind, schemaVersion: AI_CANDIDATE_SCHEMA_VERSION,
      suggestions: decodeSuggestions(payload, context, decodeDefinitionSuggestion) };
  }
  if (kind === "relation_suggestion_v1") {
    return { kind, schemaVersion: AI_CANDIDATE_SCHEMA_VERSION,
      suggestions: decodeSuggestions(payload, context, decodeRelationSuggestion) };
  }
  if (kind === "attention_suggestion_v1") {
    return { kind, schemaVersion: AI_CANDIDATE_SCHEMA_VERSION,
      suggestions: decodeSuggestions(payload, context, decodeAttentionSuggestion) };
  }
  return undefined;
}

function decodeSuggestions<Suggestion>(
  payload: Record<string, unknown>,
  context: AiCandidateDecodeContext,
  decodeSuggestion: (
    input: unknown,
    path: string,
    context: AiCandidateDecodeContext,
    seenIds: Set<string>,
  ) => Suggestion,
): readonly Suggestion[] {
  assertOnlyKeys(payload, ["kind", "schemaVersion", "suggestions"], "$");
  const suggestions = expectArray(payload.suggestions, "$.suggestions");
  const maxSuggestions = Math.min(12, context.limits?.maxStatements ?? 24);
  if (suggestions.length < 1 || suggestions.length > maxSuggestions) {
    throw new AiSchemaError(
      "limit_exceeded",
      "$.suggestions",
      `suggestion count must be 1 to ${maxSuggestions}`,
    );
  }
  const seenIds = new Set<string>();
  return suggestions.map((suggestion, index) =>
    decodeSuggestion(suggestion, `$.suggestions[${index}]`, context, seenIds));
}

function decodeConceptSuggestion(
  input: unknown,
  path: string,
  context: AiCandidateDecodeContext,
  seenIds: Set<string>,
): AiConceptSuggestionV1 {
  const value = expectRecord(input, path, "concept suggestion");
  assertOnlyKeys(value, ["id", "term", "language", "explanation", "disambiguation",
    "domain", "tradition", "period", "epistemicRole", "evidenceItemIds"], path);
  return {
    ...decodeGrounded(value, path, context, seenIds),
    term: expectRequiredString(value, "term", path, 200),
    explanation: expectRequiredString(value, "explanation", path, 2_000),
    ...optionalQualifiers(value, path),
  };
}

function decodeDefinitionSuggestion(
  input: unknown,
  path: string,
  context: AiCandidateDecodeContext,
  seenIds: Set<string>,
): AiDefinitionSuggestionV1 {
  const value = expectRecord(input, path, "definition suggestion");
  assertOnlyKeys(value, ["id", "term", "statement", "scopeNote", "epistemicRole",
    "evidenceItemIds"], path);
  const scopeNote = expectOptionalString(value.scopeNote, `${path}.scopeNote`, 1_000);
  return {
    ...decodeGrounded(value, path, context, seenIds),
    term: expectRequiredString(value, "term", path, 200),
    statement: expectRequiredString(value, "statement", path, 2_000),
    ...(scopeNote === undefined ? {} : { scopeNote }),
  };
}

function decodeRelationSuggestion(
  input: unknown,
  path: string,
  context: AiCandidateDecodeContext,
  seenIds: Set<string>,
): AiRelationSuggestionV1 {
  const value = expectRecord(input, path, "relation suggestion");
  assertOnlyKeys(value, ["id", "subjectTerm", "predicateKind", "objectTerm", "scopeNote",
    "epistemicRole", "evidenceItemIds"], path);
  const subjectTerm = expectRequiredString(value, "subjectTerm", path, 200);
  const objectTerm = expectRequiredString(value, "objectTerm", path, 200);
  if (subjectTerm === objectTerm) {
    throw new AiSchemaError("invalid_value", path, "relation endpoints must be distinct");
  }
  const scopeNote = expectOptionalString(value.scopeNote, `${path}.scopeNote`, 1_000);
  return {
    ...decodeGrounded(value, path, context, seenIds),
    subjectTerm,
    predicateKind: expectEnum(value.predicateKind, RELATION_PREDICATE_KINDS,
      `${path}.predicateKind`),
    objectTerm,
    ...(scopeNote === undefined ? {} : { scopeNote }),
  };
}

function decodeAttentionSuggestion(
  input: unknown,
  path: string,
  context: AiCandidateDecodeContext,
  seenIds: Set<string>,
): AiAttentionSuggestionV1 {
  const value = expectRecord(input, path, "attention suggestion");
  assertOnlyKeys(value, ["id", "title", "reason", "priority", "evidenceItemIds"], path);
  return {
    id: decodeSuggestionId(value, path, seenIds),
    title: expectRequiredString(value, "title", path, 240),
    reason: expectRequiredString(value, "reason", path, 2_000),
    priority: expectEnum(value.priority, ["high", "medium", "low"] as const,
      `${path}.priority`),
    evidenceItemIds: decodeEvidenceIds(value.evidenceItemIds, path, context, 1),
  };
}

function decodeGrounded(
  value: Record<string, unknown>,
  path: string,
  context: AiCandidateDecodeContext,
  seenIds: Set<string>,
): AiGroundedSuggestionV1 {
  const epistemicRole = expectEnum(value.epistemicRole, AI_EPISTEMIC_ROLES,
    `${path}.epistemicRole`);
  return {
    id: decodeSuggestionId(value, path, seenIds),
    epistemicRole,
    evidenceItemIds: decodeEvidenceIds(
      value.evidenceItemIds,
      path,
      context,
      epistemicRole === "synthesis" ? 2 : 1,
    ),
  };
}

function decodeSuggestionId(
  value: Record<string, unknown>,
  path: string,
  seenIds: Set<string>,
): string {
  const id = expectRequiredString(value, "id", path, 64);
  if (!/^[a-z][a-z0-9_-]*$/.test(id)) {
    throw new AiSchemaError("invalid_value", `${path}.id`, "invalid suggestion ID");
  }
  if (seenIds.has(id)) {
    throw new AiSchemaError("duplicate_id", `${path}.id`, `duplicate suggestion ID ${id}`);
  }
  seenIds.add(id);
  return id;
}

function decodeEvidenceIds(
  input: unknown,
  path: string,
  context: AiCandidateDecodeContext,
  minimum: number,
): readonly string[] {
  const values = expectArray(input, `${path}.evidenceItemIds`);
  const maximum = context.limits?.maxEvidenceIdsPerStatement ?? 8;
  if (values.length < minimum || values.length > maximum) {
    throw new AiSchemaError("evidence_requirement_not_met", `${path}.evidenceItemIds`,
      `requires ${minimum} to ${maximum} evidence items`);
  }
  const seen = new Set<string>();
  return values.map((value, index) => {
    const evidenceId = expectString(value, `${path}.evidenceItemIds[${index}]`, 80);
    if (!context.allowedEvidenceItemIds.has(evidenceId)) {
      throw new AiSchemaError("unknown_evidence_id", `${path}.evidenceItemIds[${index}]`,
        `evidence ID ${evidenceId} is outside the frozen bundle`);
    }
    if (seen.has(evidenceId)) {
      throw new AiSchemaError("duplicate_id", `${path}.evidenceItemIds[${index}]`,
        `duplicate evidence ID ${evidenceId}`);
    }
    seen.add(evidenceId);
    return evidenceId;
  });
}

function optionalQualifiers(
  value: Record<string, unknown>,
  path: string,
): Pick<AiConceptSuggestionV1,
  "language" | "disambiguation" | "domain" | "tradition" | "period"> {
  const entries = ([
    ["language", 40], ["disambiguation", 500], ["domain", 200],
    ["tradition", 200], ["period", 120],
  ] as const).flatMap(([key, maximum]) => {
    const decoded = expectOptionalString(value[key], `${path}.${key}`, maximum);
    return decoded === undefined ? [] : [[key, decoded] as const];
  });
  return Object.fromEntries(entries);
}
