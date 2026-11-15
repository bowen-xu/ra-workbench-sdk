import { expect, it, vi } from "vitest";
import { decodeAgentNoteApplication } from "@research-assistant/core/agent";
import { createAgentNoteApplicationGateway } from "./noteApplication";

const scope = {conversationId: "a1111111-1111-4111-8111-111111111111", pageId: "b1111111-1111-4111-8111-111111111111", turnId: "c1111111-1111-4111-8111-111111111111", itemId: "d1111111-1111-4111-8111-111111111111"};
const requestId = "e1111111-1111-4111-8111-111111111111";
const proposalId = `note-rewrite:${"a".repeat(64)}`;
const receipt = () => ({schemaVersion: 1, ...scope, applicationId: scope.itemId, proposalId, beforeRevision: 3, appliedRevision: 4, beforeHash: "a".repeat(64), afterHash: "b".repeat(64), createdAt: "2026-09-10T01:02:03.000Z"});

it("captures request identity and sends only the scope, request ID and saved revision", async () => {
  let resolve!: (value: unknown) => void;
  const invoke = vi.fn(() => new Promise(done => { resolve = done; }));
  const mutable = {...scope};
  const pending = createAgentNoteApplicationGateway(invoke).accept(mutable, requestId, proposalId, 3);
  mutable.pageId = requestId;
  expect(invoke).toHaveBeenCalledExactlyOnceWith("agent_accept_note_rewrite", {request: {scope, requestId, expectedRevision: 3}});
  resolve(receipt());expect(await pending).toEqual(receipt());
});

it("distinguishes no application, a durable historical application, and a failed read", async () => {
  const invoke = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(receipt()).mockRejectedValueOnce(new Error("offline"));
  const gateway = createAgentNoteApplicationGateway(invoke);
  expect(await gateway.status(scope, proposalId)).toBeNull();
  expect(await gateway.status(scope, proposalId)).toEqual(receipt());
  await expect(gateway.status(scope, proposalId)).rejects.toThrow("offline");
  expect(invoke.mock.calls.every(call => call[0] === "agent_note_application_status")).toBe(true);
});

it("rejects forged receipts, wrong identities, unsafe revisions, hashes and timestamps", () => {
  for (const patch of [
    {schemaVersion: 2}, {applicationId: "invalid"}, {pageId: requestId}, {proposalId: `note-rewrite:${"b".repeat(64)}`},
    {beforeRevision: -1}, {beforeRevision: 3.5}, {beforeRevision: Number.MAX_SAFE_INTEGER, appliedRevision: Number.MAX_SAFE_INTEGER + 1},
    {appliedRevision: 6}, {beforeHash: "not-a-hash"}, {afterHash: "a".repeat(64)},
    {createdAt: "2026-02-30T01:02:03.000Z"}, {extra: true},
  ]) expect(() => decodeAgentNoteApplication({...receipt(), ...patch}, scope, proposalId)).toThrow();
  expect(() => decodeAgentNoteApplication({...receipt(), beforeRevision: Number.MAX_SAFE_INTEGER - 1, appliedRevision: Number.MAX_SAFE_INTEGER}, scope, proposalId)).not.toThrow();
});

it("validates inputs before IPC and never automatically retries uncertain acceptance", async () => {
  const invoke = vi.fn().mockRejectedValue(new Error("uncertain"));
  const gateway = createAgentNoteApplicationGateway(invoke);
  for (const revision of [-1, 0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
    await expect(gateway.accept(scope, requestId, proposalId, revision)).rejects.toThrow();
  }
  await expect(gateway.accept({...scope, allowWrite: true} as typeof scope, requestId, proposalId, 3)).rejects.toThrow();
  await expect(gateway.accept(scope, "invalid", proposalId, 3)).rejects.toThrow();
  await expect(gateway.accept(scope, requestId, "invalid", 3)).rejects.toThrow();
  expect(invoke).not.toHaveBeenCalled();
  await expect(gateway.accept(scope, requestId, proposalId, 3)).rejects.toThrow("uncertain");expect(invoke).toHaveBeenCalledOnce();
});

it("rejects an otherwise valid application of a different base revision", async () => {
  const invoke = vi.fn().mockResolvedValue({...receipt(), beforeRevision: 4, appliedRevision: 5});
  await expect(createAgentNoteApplicationGateway(invoke).accept(scope, requestId, proposalId, 3)).rejects.toThrow("revision");
  expect(invoke).toHaveBeenCalledOnce();
});
