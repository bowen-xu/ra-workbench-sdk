import { expect, it, vi } from "vitest";
import { decodeAgentNoteUndo, type AgentNoteApplication } from "@research-assistant/core/agent";
import { createAgentNoteUndoGateway } from "./noteUndo";

const scope = {conversationId: "a1111111-1111-4111-8111-111111111111", pageId: "b1111111-1111-4111-8111-111111111111", turnId: "c1111111-1111-4111-8111-111111111111", itemId: "d1111111-1111-4111-8111-111111111111"};
const requestId = "e1111111-1111-4111-8111-111111111111";
const application = (): AgentNoteApplication => ({schemaVersion: 1, ...scope, applicationId: scope.itemId, proposalId: `note-rewrite:${"a".repeat(64)}`,
  beforeRevision: 3, appliedRevision: 4, beforeHash: "a".repeat(64), afterHash: "b".repeat(64), createdAt: "2026-09-10T01:02:03.000Z"});
const receipt = () => ({schemaVersion: 1, ...scope, undoId: requestId, applicationId: scope.itemId, proposalId: application().proposalId,
  beforeRevision: 4, restoredRevision: 5, beforeHash: "b".repeat(64), restoredHash: "a".repeat(64), createdAt: "2026-09-10T01:02:04.000Z"});

it("captures the original application and sends only identity and the applied revision", async () => {
  let resolve!: (value: unknown) => void;
  const invoke = vi.fn(() => new Promise(done => {resolve = done;}));
  const original = {...application()};
  const pending = createAgentNoteUndoGateway(invoke).undo(original, requestId);
  original.pageId = requestId; original.afterHash = "c".repeat(64);
  expect(invoke).toHaveBeenCalledExactlyOnceWith("agent_undo_note_rewrite", {request: {scope, applicationId: scope.itemId, requestId, expectedRevision: 4}});
  resolve(receipt()); expect(await pending).toEqual(receipt());
});
it("distinguishes no undo, a historical undo and a failed read", async () => {
  const invoke = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(receipt()).mockRejectedValueOnce(new Error("offline"));
  const gateway = createAgentNoteUndoGateway(invoke);
  expect(await gateway.status(application())).toBeNull();
  expect(await gateway.status(application())).toEqual(receipt());
  await expect(gateway.status(application())).rejects.toThrow("offline");
  expect(invoke.mock.calls.every(call => call[0] === "agent_note_undo_status")).toBe(true);
});
it("rejects receipts that do not invert exactly the original application", () => {
  for (const patch of [{schemaVersion: 2}, {undoId: "invalid"}, {applicationId: requestId}, {pageId: requestId}, {turnId: requestId},
    {proposalId: `note-rewrite:${"b".repeat(64)}`}, {beforeRevision: 3}, {restoredRevision: 6}, {beforeHash: "a".repeat(64)},
    {restoredHash: "b".repeat(64)}, {createdAt: "2026-02-30T01:02:03.000Z"}, {extra: true}]) {
    expect(() => decodeAgentNoteUndo({...receipt(), ...patch}, application())).toThrow();
  }
});
it("validates inputs and never retries a write with uncertain outcome", async () => {
  const invoke = vi.fn().mockRejectedValue(new Error("uncertain")), gateway = createAgentNoteUndoGateway(invoke);
  await expect(gateway.undo(application(), "invalid")).rejects.toThrow();
  await expect(gateway.undo({...application(), beforeRevision: Number.MAX_SAFE_INTEGER - 1, appliedRevision: Number.MAX_SAFE_INTEGER}, requestId)).rejects.toThrow();
  await expect(gateway.status({...application(), beforeHash: "invalid"})).rejects.toThrow();
  expect(invoke).not.toHaveBeenCalled();
  await expect(gateway.undo(application(), requestId)).rejects.toThrow("uncertain"); expect(invoke).toHaveBeenCalledOnce();
});
