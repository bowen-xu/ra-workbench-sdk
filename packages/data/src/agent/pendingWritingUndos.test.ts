import { expect, it, vi } from "vitest";
import { decodeAgentPendingWritingUndoPage } from "@research-assistant/core/agent";
import { createAgentPendingWritingUndoGateway } from "./pendingWritingUndos";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const manuscriptId = uuid(1);
const request = { manuscriptId, after: null, limit: 2 };
function entry(id: number, status = "prepared") {
  const scope = { manuscriptId, conversationId: uuid(2), proposalId: uuid(10 + id), operationId: uuid(20 + id) };
  const undoId = uuid(30 + id);
  return { id, undo: { schemaVersion: 1, originalScope: scope, undoId, result: {
    kind: "state", schemaVersion: 1, scope: { ...scope, operationId: undoId }, status,
    files: [{ path: "main.tex", phase: "pending", target: { kind: "disk" } }],
  } } };
}
const page = () => ({ schemaVersion: 1, manuscriptId, items: [entry(1), entry(3, "recoveryRequired")], nextCursor: 3 });

it("reads a bounded manuscript page without starting or acknowledging any Undo", async () => {
  const invoke = vi.fn().mockResolvedValue(page());
  const gateway = createAgentPendingWritingUndoGateway(invoke);
  expect(await gateway.list(request)).toEqual(page());
  expect(invoke).toHaveBeenCalledExactlyOnceWith("agent_list_pending_writing_undos", { request });
  invoke.mockResolvedValue({ ...page(), items: [entry(4, "applying")], nextCursor: null });
  expect((await gateway.list({ ...request, after: 3 })).items[0]?.id).toBe(4);
  invoke.mockResolvedValue({ ...page(), items: [], nextCursor: null });
  expect((await gateway.list({ ...request, after: 4 })).items).toEqual([]);
});
it("rejects unsafe cursors and malformed requests before IPC", async () => {
  const invoke = vi.fn();
  for (const input of [
    { ...request, limit: 0 }, { ...request, limit: 65 }, { ...request, limit: 1.5 },
    { ...request, after: 0 }, { ...request, after: Number.MAX_SAFE_INTEGER + 1 },
    { ...request, manuscriptId: "00000000-0000-0000-0000-000000000000" }, { ...request, extra: true },
  ]) await expect(createAgentPendingWritingUndoGateway(invoke).list(input)).rejects.toThrow();
  expect(invoke).not.toHaveBeenCalled();
});
it("rejects cross-manuscript, stale and over-limit transport pages", async () => {
  for (const response of [
    { ...page(), manuscriptId: uuid(9), items: [] }, page(),
    { ...page(), items: [entry(3)] },
    { ...page(), items: [entry(3), entry(4), entry(5)], nextCursor: 5 },
  ]) await expect(createAgentPendingWritingUndoGateway(vi.fn().mockResolvedValue(response))
    .list({ ...request, after: 3 })).rejects.toThrow();
});
it.each(["applied", "rolledBack"])("accepts %s editor journals awaiting host save", async status => {
  const value = entry(1, status);
  const response = { ...page(), items: [{ ...value, undo: { ...value.undo, result: { ...value.undo.result,
    files: [{ path: "main.tex", phase: status === "applied" ? "acknowledged" : "restored",
      target: { kind: "editor", sessionId: uuid(40), revision: uuid(41), resultRevision: uuid(42) } }],
  } } }], nextCursor: null };
  expect(await createAgentPendingWritingUndoGateway(vi.fn().mockResolvedValue(response)).list(request)).toEqual(response);
});
it("rejects terminal journals without editor results, executable, duplicated, unordered and foreign snapshots", () => {
  const foreign = entry(1); foreign.undo.originalScope.manuscriptId = uuid(9);
  const duplicate = entry(3); duplicate.undo = entry(1).undo;
  for (const response of [
    { ...page(), schemaVersion: 2 }, { ...page(), extra: true },
    { ...page(), items: [entry(1, "applied")], nextCursor: null },
    { ...page(), items: [entry(1, "rolledBack")], nextCursor: null },
    { ...page(), items: [{ id: 1, undo: { ...entry(1).undo, result: null } }], nextCursor: null },
    { ...page(), items: [{ id: 1, undo: { ...entry(1).undo, result: {
      kind: "edit", schemaVersion: 1, scope: entry(1).undo.result.scope,
      expected: { path: "main.tex", sessionId: uuid(50), revision: uuid(51), text: "after" }, text: "before",
    } } }], nextCursor: null },
    { ...page(), items: [foreign], nextCursor: null },
    { ...page(), items: [entry(1), duplicate] },
    { ...page(), items: [entry(3), entry(1)], nextCursor: 1 },
    { ...page(), items: [entry(1), entry(1)], nextCursor: 1 },
    { ...page(), nextCursor: 2 }, { ...page(), items: [], nextCursor: 3 },
  ]) expect(() => decodeAgentPendingWritingUndoPage(response)).toThrow();
});
