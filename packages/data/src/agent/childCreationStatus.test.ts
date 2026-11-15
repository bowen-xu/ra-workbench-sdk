import { describe, expect, it, vi } from "vitest";
import { createAgentChildCreationStatusGateway } from "./childCreationStatus";

const parent = "11111111-1111-4111-8111-111111111111";
const turn = "22222222-2222-4222-8222-222222222222";
const call = "33333333-3333-4333-8333-333333333333";
const child = "44444444-4444-4444-8444-444444444444";
const operation = "55555555-5555-4555-8555-555555555555";
const epoch = "66666666-6666-4666-8666-666666666666";
const request = { schemaVersion: 1 as const, conversationId: parent, turnId: turn, callId: call };
const response = { ...request, watermark: 42, creation: { schemaVersion: 1, conversationId: child,
  operationId: operation, status: {type: "noSqlReceipt", epoch, sqlFence: "4", closed: false} } };

describe("child creation receipt gateway", () => {
  it("uses the same read-only native command with a frozen parent call", async () => {
    const invoke = vi.fn(async (_command: string, _args: Record<string, unknown>) => response);
    const gateway = createAgentChildCreationStatusGateway(invoke);
    expect(await gateway.read(request)).toEqual(response);
    expect(invoke).toHaveBeenCalledExactlyOnceWith("agent_read_child_creation_status", { request });
    expect(invoke.mock.calls[0]?.[1]).not.toHaveProperty("request.binding");
  });

  it("rejects mismatched parent identities and malformed receipt evidence", async () => {
    for (const invalid of [
      { ...response, conversationId: child }, { ...response, turnId: child }, { ...response, callId: child },
      { ...response, watermark: Number.MAX_SAFE_INTEGER + 1 },
      { ...response, creation: { ...response.creation, status: { ...response.creation.status, closed: "false" } } },
    ]) {
      await expect(createAgentChildCreationStatusGateway(async () => invalid).read(request)).rejects.toThrow();
    }
  });

  it("preserves native recovery diagnostics and rejects invalid identities before invoking", async () => {
    const failure = {code: "intentUnavailable", conversationId: parent, turnId: turn, callId: call};
    const invoke = vi.fn(async () => { throw failure; });
    const gateway = createAgentChildCreationStatusGateway(invoke);
    await expect(gateway.read(request)).rejects.toBe(failure);
    await expect(gateway.read({...request, callId: "00000000-0000-0000-0000-000000000000"})).rejects.toThrow();
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("decodes retained submission snapshots only in the confirmed creation epoch", async () => {
    const creation = {schemaVersion: 1, conversationId: child, operationId: operation,
      status: {type: "committed", proof: {schemaVersion: 1, operationId: operation, conversationId: child,
        family: "agent.conversation.create_bound", epoch, sqlFence: "4", replayed: false, result: null}}};
    const submission = {requestId: call, epoch, record: {turnId: turn, contextSnapshotId: child}};
    const value = {...response, creation, submission};
    expect(await createAgentChildCreationStatusGateway(async () => value).read(request)).toEqual(value);
    for (const invalid of [
      {...value, submission: {...submission, epoch: child}},
      {...response, submission},
      {...value, submission: {...submission, record: {turnId: turn}}},
    ]) await expect(createAgentChildCreationStatusGateway(async () => invalid).read(request)).rejects.toThrow();
  });
});
