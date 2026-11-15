import { describe, expect, it, vi } from "vitest";
import { decodeAgentUndoRequest, decodeAgentUndoResponse, type AgentUndoRequest } from "@research-assistant/core/agent";
import { createAgentUndoGateway } from "./proposalUndos";
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { conversationId: uuid(1), manuscriptId: uuid(2), proposalId: uuid(3), operationId: uuid(4) };
const observation = { path: "main.tex", sessionId: uuid(6), revision: uuid(7), text: "after" };
const request: AgentUndoRequest = { scope, undoId: uuid(5), command: { action: "read" } };
const state = () => ({ schemaVersion: 1, originalScope: { ...scope }, undoId: uuid(5), result: {
  kind: "state", schemaVersion: 1, scope: { ...scope, operationId: uuid(5) }, status: "prepared",
  files: [{ path: "main.tex", phase: "pending", target: { kind: "disk" } }],
} });
describe("independent undo gateway", () => {
  it("validates optional Resume checkpoint CAS and freezes it before IPC", async () => {
    const buffer = { ...observation, expectedDiskSha256: "a".repeat(64) };
    const proof = { path: "main.tex", revision: 4, stateVersion: 9 };
    const command = { action: "resume" as const, buffers: [buffer], checkpointVersions: [proof] };
    expect(decodeAgentUndoRequest({ ...request, command }).command).toEqual(command);
    expect(decodeAgentUndoRequest({ ...request, command: { action: "resume", buffers: [buffer] } }).command).toEqual({ action: "resume", buffers: [buffer] });
    for (const invalid of [null, [proof, proof], [{ ...proof, path: "foreign.tex" }], [{ ...proof, revision: 0 }],
      [{ ...proof, stateVersion: -1 }], [{ ...proof, revision: Number.MAX_SAFE_INTEGER + 1 }], [{ ...proof, stateVersion: 1.5 }], [{ ...proof, extra: true }]]) {
      expect(() => decodeAgentUndoRequest({ ...request, command: { ...command, checkpointVersions: invalid } })).toThrow();
    }
    expect(() => decodeAgentUndoRequest({ ...request, command: { ...command, action: "start" } })).toThrow();
    let resolve!: (value: unknown) => void;
    const invoke = vi.fn(() => new Promise<unknown>(done => { resolve = done; }));
    const pending = createAgentUndoGateway(invoke).execute({ ...request, command });
    proof.revision = 99;
    resolve(state()); await pending;
    expect(invoke.mock.calls[0]).toEqual(["agent_writing_proposal_undo", { request: { ...request, command: { ...command,
      checkpointVersions: [{ path: "main.tex", revision: 4, stateVersion: 9 }] } } }]);
  });
  it.each(["prepareRollback", "rollbackDisk"] as const)("validates %s checkpoint evidence without changing its action", action => {
    const buffer = { ...observation, expectedDiskSha256: "a".repeat(64) };
    const proof = { path: buffer.path, revision: 3, stateVersion: 7 };
    const command = { action, buffers: [buffer], checkpointVersions: [proof] };
    expect(decodeAgentUndoRequest({ ...request, command }).command).toEqual(command);
    for (const invalid of [[proof, proof], [{ ...proof, path: "foreign.tex" }], [{ ...proof, revision: 0 }]]) {
      expect(() => decodeAgentUndoRequest({ ...request, command: { ...command, checkpointVersions: invalid } })).toThrow();
    }
  });
  it("validates both original and inverse identities including null reads", async () => {
    const response = state();
    const invoke = vi.fn().mockResolvedValue(response);
    expect(await createAgentUndoGateway(invoke).execute(request)).toEqual(response);
    expect(invoke).toHaveBeenCalledWith("agent_writing_proposal_undo", { request });
    expect(await createAgentUndoGateway(vi.fn().mockResolvedValue({ ...response, result: null })).execute(request)).toEqual({ ...response, result: null });
    for (const changed of [
      { ...response, undoId: uuid(8) },
      { ...response, originalScope: { ...scope, operationId: uuid(8) } },
      { ...response, result: { ...response.result, scope } },
      { ...response, schemaVersion: 2 },
    ]) {
      await expect(createAgentUndoGateway(vi.fn().mockResolvedValue(changed)).execute(request)).rejects.toThrow();
    }
  });
  it("rejects unknown fields, invalid paths, duplicate buffers and original-ID reuse before IPC", () => {
    const buffer = { ...observation, expectedDiskSha256: "a".repeat(64) };
    for (const value of [
      { ...request, undoId: scope.operationId },
      { ...request, command: { action: "read", extra: true } },
      { ...request, command: { action: "applyDisk", path: "../a" } },
      { ...request, command: { action: "applyDisk", path: ".agent-before-x" } },
      { ...request, command: { action: "prepare", buffers: [buffer, buffer] } },
      { ...request, command: { action: "start", buffers: [{ ...buffer, revision: "bad" }] } },
      { ...request, command: { action: "resume", buffers: [buffer, buffer] } },
    ]) expect(() => decodeAgentUndoRequest(value)).toThrow();
    expect(() => decodeAgentUndoResponse({ ...state(), extra: true })).toThrow();
  });
  it("accepts an edit only for the exact frozen prepare observation", async () => {
    const response = { ...state(), result: { kind: "edit", schemaVersion: 1,
      scope: { ...scope, operationId: uuid(5) }, expected: observation, text: "before" } };
    const value: AgentUndoRequest = { ...request, command: { action: "prepareEditor", current: observation } };
    expect(await createAgentUndoGateway(vi.fn().mockResolvedValue(response)).execute(value)).toEqual(response);
    await expect(createAgentUndoGateway(vi.fn().mockResolvedValue(response)).execute(request)).rejects.toThrow();
    await expect(createAgentUndoGateway(vi.fn().mockResolvedValue(response)).execute({ ...value, command: { action: "prepareEditor", current: { ...observation, text: "changed" } } })).rejects.toThrow();
  });
  it("requires an exact editor receipt and a matching disk target", async () => {
    const response = state();
    const confirmed = { ...response, result: { ...response.result, status: "applied", files: [{ path: "main.tex", phase: "acknowledged", target: {
      kind: "editor", sessionId: uuid(6), revision: uuid(7), resultRevision: uuid(8),
    } }] } };
    const value: AgentUndoRequest = { ...request, command: { action: "confirmEditor", actual: { ...observation, revision: uuid(8), text: "before" } } };
    expect(await createAgentUndoGateway(vi.fn().mockResolvedValue(confirmed)).execute(value)).toEqual(confirmed);
    await expect(createAgentUndoGateway(vi.fn().mockResolvedValue(confirmed)).execute({ ...value, command: { action: "confirmEditor", actual: observation } })).rejects.toThrow();
    await expect(createAgentUndoGateway(vi.fn().mockResolvedValue(confirmed)).execute({ ...request, command: { action: "applyDisk", path: "main.tex" } })).rejects.toThrow();
    await expect(createAgentUndoGateway(vi.fn().mockResolvedValue(response)).execute({ ...request, command: { action: "cancelPending" } })).rejects.toThrow();
    await expect(createAgentUndoGateway(vi.fn().mockResolvedValue({ ...response, result: null })).execute(value)).rejects.toThrow();
  });
  it("copies the caller's scope and buffer snapshot before awaiting transport", async () => {
    const buffer = { ...observation, expectedDiskSha256: "a".repeat(64) };
    const value = { ...request, scope: { ...scope }, command: { action: "prepare" as const, buffers: [buffer] } };
    let resolve: (value: unknown) => void = () => { throw new Error("not initialized"); };
    const invoke = vi.fn(() => new Promise<unknown>(done => { resolve = done; }));
    const pending = createAgentUndoGateway(invoke).execute(value);
    value.scope.operationId = uuid(9); buffer.text = "later edit";
    resolve(state());
    await expect(pending).resolves.toEqual(state());
    expect(invoke.mock.calls[0]).toEqual(["agent_writing_proposal_undo", { request: {
      ...request, command: { action: "prepare", buffers: [{ ...observation, expectedDiskSha256: "a".repeat(64) }] },
    } }]);
  });
});

it("finds durable undo state and rejects a foreign origin or an executable response", async () => {
  const invoke = vi.fn().mockResolvedValue(state());
  expect(await createAgentUndoGateway(invoke).find(scope)).toEqual(state());
  expect(invoke).toHaveBeenCalledWith("agent_find_writing_proposal_undo", { scope });
  invoke.mockResolvedValue(null);
  expect(await createAgentUndoGateway(invoke).find(scope)).toBeNull();
  for (const response of [
    { ...state(), result: null },
    { ...state(), originalScope: { ...scope, operationId: uuid(9) } },
    { ...state(), result: { kind: "edit", schemaVersion: 1, scope: { ...scope, operationId: uuid(5) }, expected: observation, text: "before" } },
  ]) {
    invoke.mockResolvedValue(response);
    await expect(createAgentUndoGateway(invoke).find(scope)).rejects.toThrow();
  }
});
