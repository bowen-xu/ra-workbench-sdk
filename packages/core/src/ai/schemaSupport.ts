export const AI_CANDIDATE_SCHEMA_VERSION = 1 as const;

export const AI_EPISTEMIC_ROLES = [
  "source_paraphrase",
  "synthesis",
  "inference",
  "uncertain",
] as const;

export type AiEpistemicRole = (typeof AI_EPISTEMIC_ROLES)[number];

export type AiSchemaErrorCode =
  | "invalid_type"
  | "invalid_value"
  | "missing_field"
  | "unknown_field"
  | "unknown_kind"
  | "unknown_schema_version"
  | "duplicate_id"
  | "unknown_evidence_id"
  | "limit_exceeded"
  | "evidence_requirement_not_met";

export class AiSchemaError extends Error {
  public constructor(
    public readonly code: AiSchemaErrorCode,
    public readonly path: string,
    message: string,
  ) {
    super(`${path}: ${message}`);
    this.name = "AiSchemaError";
  }
}

export interface AiCandidateDecodeLimits {
  readonly maxStatements: number;
  readonly maxStatementCharacters: number;
  readonly maxEvidenceIdsPerStatement: number;
  readonly maxUncertainties: number;
  readonly maxUncertaintyCharacters: number;
}

export interface AiCandidateDecodeContext {
  readonly allowedEvidenceItemIds: ReadonlySet<string>;
  readonly limits?: Partial<AiCandidateDecodeLimits>;
}

export const DEFAULT_AI_CANDIDATE_DECODE_LIMITS: AiCandidateDecodeLimits = {
  maxStatements: 24,
  maxStatementCharacters: 2_000,
  maxEvidenceIdsPerStatement: 8,
  maxUncertainties: 12,
  maxUncertaintyCharacters: 1_000,
};

export function expectRecord(
  input: unknown,
  path: string,
  label: string,
): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new AiSchemaError("invalid_type", path, `${label} must be an object`);
  }
  return input as Record<string, unknown>;
}

export function expectArray(input: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(input)) {
    throw new AiSchemaError("invalid_type", path, "must be an array");
  }
  return input;
}

export function expectRequiredString(
  record: Record<string, unknown>,
  key: string,
  parentPath: string,
  maxCharacters: number,
): string {
  if (!(key in record)) {
    throw new AiSchemaError("missing_field", `${parentPath}.${key}`, "field is required");
  }
  return expectString(record[key], `${parentPath}.${key}`, maxCharacters);
}

export function expectString(input: unknown, path: string, maxCharacters: number): string {
  if (typeof input !== "string") {
    throw new AiSchemaError("invalid_type", path, "must be a string");
  }
  const value = input.trim();
  if (value.length === 0) {
    throw new AiSchemaError("invalid_value", path, "must not be empty");
  }
  if (Array.from(value).length > maxCharacters) {
    throw new AiSchemaError("limit_exceeded", path, `character count exceeds ${maxCharacters}`);
  }
  return value;
}

export function expectOptionalString(
  input: unknown,
  path: string,
  maxCharacters: number,
): string | undefined {
  if (input === undefined) return undefined;
  return expectString(input, path, maxCharacters);
}

export function expectRequiredInteger(
  record: Record<string, unknown>,
  key: string,
  parentPath: string,
  minimum: number,
  maximum: number,
): number {
  if (!(key in record)) {
    throw new AiSchemaError("missing_field", `${parentPath}.${key}`, "field is required");
  }
  const value = record[key];
  if (!Number.isInteger(value) || typeof value !== "number") {
    throw new AiSchemaError("invalid_type", `${parentPath}.${key}`, "must be an integer");
  }
  if (value < minimum || value > maximum) {
    throw new AiSchemaError("invalid_value", `${parentPath}.${key}`, "is outside the allowed range");
  }
  return value;
}

export function expectEnum<const T extends readonly string[]>(
  input: unknown,
  values: T,
  path: string,
): T[number] {
  if (typeof input !== "string" || !values.includes(input)) {
    throw new AiSchemaError("invalid_value", path, `must be one of ${values.join(", ")}`);
  }
  return input as T[number];
}

export function assertOnlyKeys(
  record: Record<string, unknown>,
  allowedKeys: readonly string[],
  path: string,
): void {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new AiSchemaError("unknown_field", `${path}.${key}`, "field is not allowed");
    }
  }
}
