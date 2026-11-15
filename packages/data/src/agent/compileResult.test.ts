import { describe, expect, it, vi } from "vitest";
import { createAgentCompileResultGateway } from "./compileResult";

const id = "11111111-1111-4111-8111-111111111111";
const result = { status: "succeeded" as const, resultId: id, compileVersion: id, rootPath: "main.tex", exitCode: 0,
  diagnostics: [], artifacts: { pdf: true, synctex: true }, retained: true, createdAtUnixSeconds: 1_800_000_000, expiresAfterSeconds: 3600,
  identity: { conversationId: id, requestId: id, turnId: id, contextSnapshotId: id, manuscriptId: id, leaseId: id, manifestHash: "a".repeat(64) } };

describe("agent compile result gateway", () => {
  it("passes the complete identity to the native reader", async () => {
    const invoke = vi.fn().mockResolvedValue([37, 80, 68, 70]);
    const gateway = createAgentCompileResultGateway(invoke);
    await expect(gateway.readPdf(result)).resolves.toEqual(new Uint8Array([37, 80, 68, 70]));
    expect(invoke).toHaveBeenCalledWith("read_agent_compile_pdf", expect.objectContaining({ resultId: id, manifestHash: "a".repeat(64) }));
  });
  it("decodes forward locations from the native adapter", async () => {
    const invoke = vi.fn().mockResolvedValue([{ page: 2, x: 1, y: 2, width: 3, height: 4 }]);
    const locations = await createAgentCompileResultGateway(invoke).forwardSynctex(result, "main.tex", 4, 0);
    expect(locations[0]?.page).toBe(2);
  });
  it("decodes inverse locations from the native adapter", async () => {
    const invoke = vi.fn().mockResolvedValue([{ relativePath: "main.tex", line: 4, column: null }]);
    const locations = await createAgentCompileResultGateway(invoke).inverseSynctex(result, 2, 1, 2);
    expect(locations[0]?.relativePath).toBe("main.tex");
  });
  it("does not read artifacts from an unretained result", async () => {
    const invoke = vi.fn();
    await expect(createAgentCompileResultGateway(invoke).readPdf({ ...result, retained: false })).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });
});
