import { expect, it, vi } from "vitest";
import { decodeAgentPendingWritingApplicationPage } from "@research-assistant/core/agent";
import { createAgentPendingWritingApplicationGateway } from "./pendingWritingApplications";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const manuscriptId = uuid(1);
const request = { manuscriptId, after: null, limit: 2 };
function entry(id: number, status = "applying") {
  return { id, application: { kind: "state", schemaVersion: 1,
    scope: { manuscriptId, conversationId: uuid(2), proposalId: uuid(10 + id), operationId: uuid(20 + id) }, status,
    files: [{ path: "main.tex", phase: "pending", target: { kind: "disk" } }],
  } };
}
const page = () => ({ schemaVersion: 1, manuscriptId, items: [entry(1), entry(3, "recoveryRequired")], nextCursor: 3 });

it("discovers admitted file journals using only manuscript pagination, without file commands", async () => {
  const invoke = vi.fn().mockResolvedValue(page());
  const gateway = createAgentPendingWritingApplicationGateway(invoke);
  expect(await gateway.list(request)).toEqual(page());
  expect(invoke).toHaveBeenCalledExactlyOnceWith("agent_list_pending_writing_applications", { request });
  invoke.mockResolvedValue({ ...page(), items: [entry(4, "prepared")], nextCursor: null });
  expect((await gateway.list({ ...request, after: 3 })).items[0]?.id).toBe(4);
  invoke.mockResolvedValue({ ...page(), items: [], nextCursor: null });
  expect((await gateway.list({ ...request, after: 4 })).items).toEqual([]);
});
it("rejects invalid requests before IPC", async () => {
  const invoke = vi.fn();
  for (const input of [
    { ...request, limit: 0 }, { ...request, limit: 65 }, { ...request, limit: 1.5 },
    { ...request, after: 0 }, { ...request, after: Number.MAX_SAFE_INTEGER + 1 },
    { ...request, manuscriptId: "00000000-0000-0000-0000-000000000000" }, { ...request, conversationId: uuid(2) },
  ]) await expect(createAgentPendingWritingApplicationGateway(invoke).list(input)).rejects.toThrow();
  expect(invoke).not.toHaveBeenCalled();
});
it("rejects foreign, stale and over-limit transport pages", async () => {
  for (const response of [
    { ...page(), manuscriptId: uuid(9), items: [] }, page(),
    { ...page(), items: [entry(3)] },
    { ...page(), items: [entry(4), entry(5), entry(6)], nextCursor: 6 },
    { ...page(), items: [entry(4)], nextCursor: 4 },
  ]) await expect(createAgentPendingWritingApplicationGateway(vi.fn().mockResolvedValue(response))
    .list({ ...request, after: 3 })).rejects.toThrow();
});
it.each(["applied", "rolledBack"])("accepts %s editor results awaiting host save", async status => {
  const value = entry(1, status);
  const response = { ...page(), items: [{ ...value, application: { ...value.application,
    files: [{ path: "main.tex", phase: status === "applied" ? "acknowledged" : "restored",
      target: { kind: "editor", sessionId: uuid(40), revision: uuid(41), resultRevision: uuid(42) } }],
  } }], nextCursor: null };
  expect(await createAgentPendingWritingApplicationGateway(vi.fn().mockResolvedValue(response)).list(request)).toEqual(response);
});
it("rejects executable responses, terminal disk-only results, duplicates and malformed snapshots", () => {
  const foreign = entry(1); foreign.application.scope.manuscriptId = uuid(9);
  const duplicateOperation = entry(3); duplicateOperation.application.scope.operationId = entry(1).application.scope.operationId;
  const duplicateProposal = entry(3); duplicateProposal.application.scope.proposalId = entry(1).application.scope.proposalId;
  for (const response of [
    { ...page(), schemaVersion: 2 }, { ...page(), extra: true },
    { ...page(), items: [entry(1, "applied")], nextCursor: null },
    { ...page(), items: [entry(1, "rolledBack")], nextCursor: null },
    { ...page(), items: [{ id: 1, application: {
      kind: "edit", schemaVersion: 1, scope: entry(1).application.scope,
      expected: { path: "main.tex", sessionId: uuid(50), revision: uuid(51), text: "before" }, text: "after",
    } }], nextCursor: null },
    { ...page(), items: [foreign], nextCursor: null },
    { ...page(), items: [entry(1), duplicateOperation] },
    { ...page(), items: [entry(1), duplicateProposal] },
    { ...page(), items: [entry(3), entry(1)], nextCursor: 1 },
    { ...page(), items: [entry(1), entry(1)], nextCursor: 1 },
    { ...page(), nextCursor: 2 }, { ...page(), items: [], nextCursor: 3 },
  ]) expect(() => decodeAgentPendingWritingApplicationPage(response)).toThrow();
});
