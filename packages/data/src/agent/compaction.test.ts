import { describe, expect, it, vi } from "vitest";
import { AgentCompactionDecodeError, AgentSubmissionDecodeError, type AgentCompactionStartRequest } from "@research-assistant/core/agent";
import { createAgentCompactionGateway } from "./compaction";

const id = "abcdef01-2345-6789-abcd-ef0123456789";
const other = "00000000-0000-0000-0000-000000000002";
const turnId = "00000000-0000-0000-0000-000000000003";
function request(): AgentCompactionStartRequest {
  return { conversationId: id, requestId: id, contextSnapshotId: id, expectedRevision: 12,
    model: { providerId: "fixture", modelId: "fixture", revision: "1" }, host: { kind: "manuscript", manuscriptId: id } };
}
const admitted = { schemaVersion: 1, conversationId: id, requestId: id, turnId, alreadyStarted: false, outcome: null };

describe("shared native compaction gateway", () => {
  it("sends only the frozen native shape and returns admission without fabricating completion or usage", async () => {
    const invoke = vi.fn(async () => admitted);
    const result = await createAgentCompactionGateway(invoke).start(request());
    expect(invoke).toHaveBeenCalledExactlyOnceWith("agent_start_compaction", { request: request() });
    expect(result).toEqual(admitted);
    expect(result).not.toHaveProperty("windowId");
    expect(result).not.toHaveProperty("usage");
  });
  it("retains the same request and native outcome on already-started recovery", async () => {
    for (const outcome of [null, "completed", "failed", "canceled", "interrupted"]) {
      const saved = { ...admitted, alreadyStarted: true, outcome };
      const invoke = vi.fn(async () => saved);
      const gateway = createAgentCompactionGateway(invoke);
      expect(await gateway.start(request())).toEqual(saved);
      expect(await gateway.start(request())).toEqual(saved);
      expect(invoke.mock.calls).toHaveLength(2);
    }
  });
  it("normalizes UUID spelling and checks both conversation and request identities", async () => {
    const invoke = vi.fn(async () => ({ ...admitted, conversationId: id.toUpperCase() }));
    expect(await createAgentCompactionGateway(invoke).start({ ...request(), requestId: id.replaceAll("-", "") })).toEqual(admitted);
    for (const field of ["conversationId", "requestId"]) {
      await expect(createAgentCompactionGateway(async () => ({ ...admitted, [field]: other })).start(request())).rejects.toThrow(AgentSubmissionDecodeError);
    }
  });
  it("keeps the original request confirmation stable while I/O is pending", async () => {
    let finish!: (value: unknown) => void;
    const invoke = vi.fn(() => new Promise<unknown>(resolve => { finish = resolve; }));
    const input = { ...request(), model: { ...request().model } };
    const pending = createAgentCompactionGateway(invoke).start(input);
    input.expectedRevision = 99;
    input.model.modelId = "changed-after-start";
    finish(admitted);
    expect(await pending).toEqual(admitted);
    expect(invoke).toHaveBeenCalledExactlyOnceWith("agent_start_compaction", { request: request() });
  });
  it("rejects invalid local envelopes before invoke and preserves native structured errors", async () => {
    const invoke = vi.fn(async () => admitted);
    await expect(createAgentCompactionGateway(invoke).start({ ...request(), expectedRevision: -1 })).rejects.toThrow(AgentCompactionDecodeError);
    expect(invoke).not.toHaveBeenCalled();
    const conflict = { code: "historyChanged", reason: { expected: 12, actual: 13 } };
    await expect(createAgentCompactionGateway(async () => { throw conflict; }).start(request())).rejects.toBe(conflict);
  });
});
