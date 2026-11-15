import { describe, expect, it } from "vitest";
import { decodeAgentPaperReadingHistoryMigrationRequest, decodeAgentPaperReadingHistoryMigrationResult } from "./paperMigration";

describe("paper reading history migration contract", () => {
  it("accepts a bounded result", () => {
    expect(decodeAgentPaperReadingHistoryMigrationResult({ schemaVersion: 1, migratedCount: 2, skippedCount: 1 }).migratedCount).toBe(2);
  });
  it("rejects malformed identifiers and counters", () => {
    expect(() => decodeAgentPaperReadingHistoryMigrationRequest({ paperId: "" })).toThrow();
    expect(() => decodeAgentPaperReadingHistoryMigrationResult({ schemaVersion: 1, migratedCount: -1, skippedCount: 0 })).toThrow();
  });
});
