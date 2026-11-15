import { row, utf8Length } from "./workspaceDecoding";

export interface AgentPaperReadingHistoryMigrationRequest { readonly paperId: string; }
export interface AgentPaperReadingHistoryMigrationResult {
  readonly schemaVersion: 1;
  readonly migratedCount: number;
  readonly skippedCount: number;
}
function fail(): never { throw new Error("Invalid paper reading history migration response"); }
function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || utf8Length(value) > 256 || value.includes("\0")) return fail();
  return value;
}
export function decodeAgentPaperReadingHistoryMigrationRequest(value: unknown): AgentPaperReadingHistoryMigrationRequest {
  const r = row(value, ["paperId"]); return { paperId: text(r.paperId) };
}
export function decodeAgentPaperReadingHistoryMigrationResult(value: unknown): AgentPaperReadingHistoryMigrationResult {
  const r = row(value, ["schemaVersion", "migratedCount", "skippedCount"]);
  const migratedCount = r.migratedCount, skippedCount = r.skippedCount;
  if (r.schemaVersion !== 1 || typeof migratedCount !== "number" || typeof skippedCount !== "number"
    || !Number.isSafeInteger(migratedCount) || !Number.isSafeInteger(skippedCount)
    || migratedCount < 0 || skippedCount < 0) return fail();
  return { schemaVersion: 1, migratedCount, skippedCount };
}
