import { expect, it, vi } from "vitest";
import { decodeAgentWorkspaceReview, decodeAgentWorkspaceFileReview, type AgentWorkspaceFileReview } from "@research-assistant/core/agent";
import { createAgentWorkspaceReviewGateway } from "./workspaceReview";
const id = "11111111-1111-4111-8111-111111111111";
const scope = { conversationId: id, requestId: id, manuscriptId: id, contextSnapshotId: id };
const binding = { scope, turnId: id, leaseId: id, manifestHash: "a".repeat(64) };
const before = { sha256: "b".repeat(64), byteSize: 3, executable: false };
const after = { sha256: "c".repeat(64), byteSize: 4, executable: false };
const change = { path: "main.tex", kind: "modified" as const, before, after, hasEditorBuffer: true };
const inventory = { schemaVersion: 1, binding, changes: [change] };
const file: AgentWorkspaceFileReview = { schemaVersion: 1, binding, change, before: { kind: "text", text: "旧" }, after: { kind: "text", text: "新!" } };

it("routes read-only commands and preserves exact UTF-8 contents and identity", async () => {
  const invoke = vi.fn().mockResolvedValueOnce(inventory).mockResolvedValueOnce(file);
  const gateway = createAgentWorkspaceReviewGateway(invoke);
  expect(await gateway.review(scope)).toEqual(inventory);
  expect(invoke).toHaveBeenNthCalledWith(1, "agent_review_writing_workspace", { request: scope });
  const request = { binding, path: change.path, before, after };
  expect(await gateway.readFile(request)).toEqual(file);
  expect(invoke).toHaveBeenNthCalledWith(2, "agent_review_writing_workspace_file", { request });
});
it("reviews an exact binding and rejects another workspace lease", async () => {
  const invoke = vi.fn().mockResolvedValueOnce(inventory).mockResolvedValueOnce({ ...inventory, binding: { ...binding, leaseId: "22222222-2222-4222-8222-222222222222" } });
  const gateway = createAgentWorkspaceReviewGateway(invoke);
  expect(await gateway.reviewBinding(binding)).toEqual(inventory);
  expect(invoke).toHaveBeenNthCalledWith(1, "agent_review_writing_workspace_binding", { request: binding });
  await expect(gateway.reviewBinding(binding)).rejects.toThrow();
});
it("rejects malformed inventory and impossible change kinds", () => {
  for (const value of [ { ...inventory, schemaVersion: 2 }, { ...inventory, unknown: true },
    { ...inventory, changes: [change, change] }, { ...inventory, changes: [{ ...change, path: "../outside" }] },
    { ...inventory, changes: [{ ...change, path: "bad\ud800" }] },
    { ...inventory, changes: [{ ...change, kind: "added" }] },
    { ...inventory, changes: [{ ...change, after: before }] },
    { ...inventory, binding: { ...binding, leaseId: "not-an-id" } },
    { ...inventory, changes: [{ ...change, after: { ...after, byteSize: 0.5 } }] },
  ]) expect(() => decodeAgentWorkspaceReview(value)).toThrow();
});
it("distinguishes absent, empty, binary and oversized sides without inventing text", () => {
  const added = { ...change, kind: "added", before: null, hasEditorBuffer: false, after: { ...after, byteSize: 0 } };
  expect(decodeAgentWorkspaceFileReview({ ...file, change: added, before: null, after: { kind: "text", text: "" } }).before).toBeNull();
  expect(decodeAgentWorkspaceFileReview({ ...file, after: { kind: "binary" } }).after).toEqual({ kind: "binary" });
  expect(decodeAgentWorkspaceFileReview({ ...file, change: { ...change, after: { ...after, byteSize: 1048577 } }, after: { kind: "tooLarge" } }).after).toEqual({ kind: "tooLarge" });
  for (const value of [ { ...file, before: null }, { ...file, after: { kind: "text", text: "new" } },
    { ...file, after: { kind: "binary", text: "hidden" } }, { ...file, after: { kind: "tooLarge" } },
    { ...file, after: { kind: "text", text: "a\0bc" } },
    { ...file, change: added, before: { kind: "text", text: "" }, after: { kind: "text", text: "" } },
  ]) expect(() => decodeAgentWorkspaceFileReview(value)).toThrow();
});
it("rejects an otherwise valid response for another scope, lease, path or version", async () => {
  const request = { binding, path: change.path, before, after };
  for (const value of [ { ...file, binding: { ...binding, scope: { ...scope, manuscriptId: "22222222-2222-4222-8222-222222222222" } } },
    { ...file, binding: { ...binding, leaseId: "22222222-2222-4222-8222-222222222222" } },
    { ...file, change: { ...change, path: "another.tex" } },
    { ...file, change: { ...change, after: { ...after, executable: true } } },
  ]) await expect(createAgentWorkspaceReviewGateway(vi.fn().mockResolvedValue(value)).readFile(request)).rejects.toThrow();
});
it("compares late responses with the original request even if the caller changes its object", async () => {
  let resolve!: (value: unknown) => void;
  const invoke = vi.fn((_command: string, _args: unknown) => new Promise<unknown>((done) => { resolve = done; }));
  const request = { binding: { ...binding, scope: { ...scope } }, path: change.path, before: { ...before }, after: { ...after } };
  const pending = createAgentWorkspaceReviewGateway(invoke).readFile(request);
  request.path = "different.tex"; request.after.executable = true;
  resolve(file);
  expect(await pending).toEqual(file);
  expect(invoke.mock.calls[0]?.[1]).toEqual({ request: { binding, path: "main.tex", before, after } });
});
