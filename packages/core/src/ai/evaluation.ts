import {
  AiSchemaError,
  decodeAiCandidatePayload,
  type AiAtomicStatementV1,
  type AiCandidateDecodeContext,
  type AiCandidatePayloadV1,
  type AiSchemaErrorCode,
} from "./schema";

export interface AiCandidateCitationMetrics {
  readonly statementCount: number;
  readonly statementWithEvidenceCount: number;
  readonly evidenceReferenceCount: number;
  readonly uniqueEvidenceItemCount: number;
  readonly citationCoverage: number;
}

export type AiCandidateInspection =
  | {
      readonly valid: true;
      readonly candidate: AiCandidatePayloadV1;
      readonly metrics: AiCandidateCitationMetrics;
    }
  | {
      readonly valid: false;
      readonly errorCode: AiSchemaErrorCode | "unexpected_decode_error";
      readonly errorPath: string;
    };

export function inspectAiCandidatePayload(
  input: unknown,
  context: AiCandidateDecodeContext,
): AiCandidateInspection {
  try {
    const candidate = decodeAiCandidatePayload(input, context);
    return { valid: true, candidate, metrics: calculateCitationMetrics(candidate) };
  } catch (error) {
    if (error instanceof AiSchemaError) {
      return { valid: false, errorCode: error.code, errorPath: error.path };
    }
    return { valid: false, errorCode: "unexpected_decode_error", errorPath: "$" };
  }
}

export function calculateCitationMetrics(
  candidate: AiCandidatePayloadV1,
): AiCandidateCitationMetrics {
  const statements = citationBearingItems(candidate);
  return calculateStatementMetrics(statements);
}

function citationBearingItems(
  candidate: AiCandidatePayloadV1,
): readonly Pick<AiAtomicStatementV1, "evidenceItemIds">[] {
  switch (candidate.kind) {
    case "paper_portrait_v1":
      return candidate.claims.map(claim => ({ evidenceItemIds: claim.evidence.map(source => source.evidenceItemId) }));
    case "selection_explanation_v1":
      return candidate.statements;
    case "paper_overview_unit_v1":
      return candidate.fields.flatMap((field) => field.statements);
    case "paper_concept_map_v1":
      return [
        ...candidate.concepts,
        ...candidate.concepts.flatMap((concept) => concept.definitionClaims),
        ...candidate.relations,
      ];
    case "reference_record_candidate_v1":
      return [{ evidenceItemIds: candidate.evidenceItemIds }, ...candidate.fields];
    case "derived_research_view_v1":
      return candidate.items;
    case "concept_suggestion_v1":
    case "definition_suggestion_v1":
    case "relation_suggestion_v1":
    case "attention_suggestion_v1":
      return candidate.suggestions;
  }
}

function calculateStatementMetrics(
  statements: readonly Pick<AiAtomicStatementV1, "evidenceItemIds">[],
): AiCandidateCitationMetrics {
  const statementWithEvidenceCount = statements.filter(
    (statement) => statement.evidenceItemIds.length > 0,
  ).length;
  const evidenceItemIds = statements.flatMap((statement) => statement.evidenceItemIds);
  return {
    statementCount: statements.length,
    statementWithEvidenceCount,
    evidenceReferenceCount: evidenceItemIds.length,
    uniqueEvidenceItemCount: new Set(evidenceItemIds).size,
    citationCoverage: statements.length === 0 ? 1 : statementWithEvidenceCount / statements.length,
  };
}
