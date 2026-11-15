import { AgentSubmissionDecodeError } from "./submission";

export type AgentSkillCatalogErrorCode = "not_found" | "invalid_document" | "invalid_selection" |
  "budget_exceeded" | "invalid_encoding" | "unavailable" | "unsupported_platform" | "unauthorized";

export interface AgentSkillSummary {
  readonly sourceId: string;
  readonly name: string;
  readonly description: string;
  readonly revision: string;
  readonly allowImplicitInvocation: boolean;
  readonly enabled: boolean;
}

export interface AgentSkillCatalogError {
  readonly sourceId: string;
  readonly code: AgentSkillCatalogErrorCode;
}

export interface AgentSkillCatalog {
  readonly schemaVersion: 1;
  readonly environmentId: "application";
  readonly skills: readonly AgentSkillSummary[];
  readonly errors: readonly AgentSkillCatalogError[];
}

const codes = new Set<AgentSkillCatalogErrorCode>([
  "not_found", "invalid_document", "invalid_selection", "budget_exceeded", "invalid_encoding",
  "unavailable", "unsupported_platform", "unauthorized",
]);

function fail(): never { throw new AgentSubmissionDecodeError(); }
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== keys.length || keys.some((key) => !Object.hasOwn(row, key))) return fail();
  return row;
}
function utf8Bytes(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const point = character.codePointAt(0)!;
    if (point >= 0xd800 && point <= 0xdfff) return Number.POSITIVE_INFINITY;
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  return bytes;
}
function text(value: unknown, max = 65_536): string {
  if (typeof value !== "string" || !value.trim() || value.includes("\0") || utf8Bytes(value) > max) return fail();
  return value;
}

export function decodeAgentSkillCatalog(value: unknown): AgentSkillCatalog {
  const row = object(value, ["schemaVersion", "environmentId", "skills", "errors"]);
  if (row.schemaVersion !== 1 || row.environmentId !== "application" || !Array.isArray(row.skills) || row.skills.length > 256 || !Array.isArray(row.errors) || row.errors.length > 256) return fail();
  const sources = new Set<string>();
  const skills = row.skills.map((value) => {
    const skill = object(value, ["sourceId", "name", "description", "revision", "allowImplicitInvocation", "enabled"]);
    const sourceId = text(skill.sourceId, 1024);
    if (sources.has(sourceId) || typeof skill.allowImplicitInvocation !== "boolean" || typeof skill.enabled !== "boolean") return fail();
    sources.add(sourceId);
    return { sourceId, name: text(skill.name, 256), description: text(skill.description), revision: text(skill.revision, 1024), allowImplicitInvocation: skill.allowImplicitInvocation, enabled: skill.enabled };
  });
  const errors = row.errors.map((value) => {
    const error = object(value, ["sourceId", "code"]);
    const code = text(error.code, 64) as AgentSkillCatalogErrorCode;
    if (!codes.has(code)) return fail();
    return { sourceId: text(error.sourceId, 1024), code };
  });
  return { schemaVersion: 1, environmentId: "application", skills, errors };
}
