import { describe, expect, it } from "vitest";
import { decodeAgentCompileResult } from "./compileResult";

const id = "11111111-1111-4111-8111-111111111111";
const result = { status: "succeeded", resultId: id, compileVersion: id, rootPath: "main.tex", exitCode: 0,
  diagnostics: [], artifacts: { pdf: true, synctex: true }, retained: true, createdAtUnixSeconds: 1_800_000_000, expiresAfterSeconds: 3600,
  identity: { conversationId: id, requestId: id, turnId: id, contextSnapshotId: id, manuscriptId: id, leaseId: id, manifestHash: "a".repeat(64) } };

describe("agent compile result", () => {
  it("decodes the identity needed for temporary artifact reads", () => {
    expect(decodeAgentCompileResult(result).identity.manifestHash).toBe("a".repeat(64));
  });
  it("rejects an unbound or malformed result", () => {
    expect(() => decodeAgentCompileResult({ ...result, retained: false })).not.toThrow();
    expect(() => decodeAgentCompileResult({ ...result, identity: { ...result.identity, manifestHash: "bad" } })).toThrow();
  });
  it("accepts the byte-size artifact shape emitted by the Rust tool", () => {
    const decoded = decodeAgentCompileResult({ ...result, artifacts: { pdf: { byteSize: 42 }, synctex: { byteSize: 7 } } });
    expect(decoded.artifacts).toEqual({ pdf: true, synctex: true });
  });
});
