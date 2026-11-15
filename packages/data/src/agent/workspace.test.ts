import { describe, expect, it, vi } from "vitest";
import { decodeAgentWorkspacePreview, type AgentWorkspaceScope } from "@research-assistant/core/agent";
import { createAgentWorkspaceGateway } from "./workspace";
const id = "11111111-1111-4111-8111-111111111111";
const scope: AgentWorkspaceScope = { conversationId: id, requestId: id, manuscriptId: id, contextSnapshotId: id };
const confirmation = { scope, turnId: id, leaseId: id, manifestHash: "a".repeat(64) };
const preview = { ...scope, schemaVersion: 1, turnId: id, leaseId: id, manifestHash: confirmation.manifestHash,
  policy: "offline_workspace_v1", approved: false, files: [{ path: "main.tex", byteSize: 10, hasEditorBuffer: true }] };

describe("execution workspace IPC", () => {
  it("prepares without granting consent and binds approval to the exact preview", async () => {
    const invoke = vi.fn().mockResolvedValueOnce(preview).mockResolvedValueOnce({ ...preview, approved: true }).mockResolvedValueOnce(null);
    const gateway = createAgentWorkspaceGateway(invoke);
    const request = { scope, buffers: [{ path: "main.tex", expectedDiskSha256: "b".repeat(64), sessionId: id, revision: id, text: "unsaved" }] };
    expect((await gateway.prepare(request)).approved).toBe(false);
    expect(invoke).toHaveBeenNthCalledWith(1, "agent_prepare_writing_workspace", { request });
    expect((await gateway.approve(confirmation)).approved).toBe(true);
    await gateway.revoke(confirmation);
    expect(invoke).toHaveBeenNthCalledWith(3, "agent_revoke_writing_workspace", { request: confirmation });
  });
  it("rejects stale scope and substituted approval receipts", async () => {
    const invoke = vi.fn().mockResolvedValueOnce({ ...preview, contextSnapshotId: "22222222-2222-4222-8222-222222222222" })
      .mockResolvedValueOnce({ ...preview, approved: true, manifestHash: "b".repeat(64) }).mockResolvedValueOnce({});
    const gateway = createAgentWorkspaceGateway(invoke);
    await expect(gateway.restore(scope)).rejects.toThrow();
    await expect(gateway.approve(confirmation)).rejects.toThrow();
    await expect(gateway.revoke(confirmation)).rejects.toThrow();
  });
  it("rejects future policies, source text, duplicate files and unsafe paths", () => {
    for (const value of [{ ...preview, policy: "unrestricted" }, { ...preview, text: "private" },
      { ...preview, files: [...preview.files, ...preview.files] },
      ...["../main.tex", "/main.tex", "C:/main.tex", ".git/config", "nul.txt"].map((path) => ({ ...preview, files: [{ ...preview.files[0], path }] }))]) {
      expect(() => decodeAgentWorkspacePreview(value)).toThrow();
    }
    expect(decodeAgentWorkspacePreview(preview)).toEqual(preview);
  });
});
