import { describe, expect, it, vi } from "vitest";
import { createAgentPaperReadingHistoryMigrationGateway } from "./paperMigration";

describe("paper reading history migration gateway", () => {
  it("uses the native migration command", async () => {
    const invoke = vi.fn().mockResolvedValue({ schemaVersion: 1, migratedCount: 1, skippedCount: 0 });
    const result = await createAgentPaperReadingHistoryMigrationGateway(invoke).migrate({ paperId: "paper-1" });
    expect(result.migratedCount).toBe(1);
    expect(invoke).toHaveBeenCalledWith("agent_migrate_paper_reading_history", { request: { paperId: "paper-1" } });
  });
});
