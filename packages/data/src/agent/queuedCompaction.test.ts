import { describe, expect, it, vi } from "vitest";
import {
  decodeAgentWritingQueuedCompactionPrepareRequest, decodeAgentWritingQueuedCompactionPreview,
  type AgentWritingQueuedCompactionPrepareRequest, type AgentWritingQueuedCompactionPreview,
  type AgentWritingQueuedCompactionSettleRequest, type AgentWritingQueuedCompactionSettleResponse,
} from "@research-assistant/core/agent";
import { createAgentCompactionGateway } from "./compaction";

const id = (n: number) => `abcdef00-1234-5678-abcd-${String(n).padStart(12, "0")}`;
function request(): AgentWritingQueuedCompactionPrepareRequest {
  return { inputId: id(1), expectedQueueRevision: 4, previousRequestId: null, expectedRevision: 17,
    submission: { conversationId: id(2), requestId: id(3), text: " /compact ", context: { manuscriptId: id(4), files: [] } } };
}
function expectedRequest(): AgentWritingQueuedCompactionPrepareRequest {
  const value = request();
  return { ...value, submission: { ...value.submission, userInput: [], resources: [], retrieval: null,
    model: null, sessionConfig: null, turnConfig: null } };
}
function prepared(): AgentWritingQueuedCompactionPreview {
  const value = request();
  return { schemaVersion: 1, kind: "compact", inputId: value.inputId, requestId: value.submission.requestId,
    claimRevision: 4, expectedRevision: 17, current: true, outcome: null,
    preview: { schemaVersion: 1, conversationId: id(2), manuscriptId: id(4), requestId: id(3), turnId: id(5), contextSnapshotId: id(6),
      input: { text: " /compact ", model: { providerId: "future-provider", modelId: "future-model", revision: null }, reasoningEffort: null, context: [] } },
    queue: { schemaVersion: 1, conversationId: id(2), manuscriptId: id(4), revision: 5, paused: false, preparingInputId: id(1),
      inputs: [{ inputId: id(1), text: " /compact " }] } };
}
function settle(): AgentWritingQueuedCompactionSettleRequest {
  return { operationId: id(7), conversationId: id(2), manuscriptId: id(4), inputId: id(1), requestId: id(3), expectedQueueRevision: 9, claimRevision: 4 };
}
function settled(outcome: AgentWritingQueuedCompactionSettleResponse["outcome"] = "completed"): AgentWritingQueuedCompactionSettleResponse {
  return { schemaVersion: 1, inputId: id(1), requestId: id(3), outcome,
    queue: { ...prepared().queue, revision: 10, preparingInputId: null, paused: outcome !== "completed",
      inputs: outcome === "completed" ? [] : prepared().queue.inputs } };
}

function retired(): AgentWritingQueuedCompactionPreview {
  return {...prepared(), current: false, retirement: {
    schemaVersion: 1,
    intent: {conversationId: id(2), manuscriptId: id(4), inputId: id(1), previewRequestId: id(3), requestId: id(20), expectedRevision: 9},
    status: {type: "committed", proof: {schemaVersion: 1, family: "agent.queue.preview.cancel", operationId: id(20),
      conversationId: id(2), epoch: id(21), sqlFence: "7", replayed: true, result: null},
      queue: {...prepared().queue, revision: 10, preparingInputId: null, paused: true}},
  }};
}

describe("queued compaction gateway identity", () => {
  it("uses distinct I/R and dedicated endpoints without ordinary admission", async () => {
    const invoke = vi.fn(async (command: string) => command === "agent_settle_writing_queued_compaction" ? settled() : prepared());
    const gateway = createAgentCompactionGateway(invoke);
    expect(await gateway.prepareWritingQueued(request())).toEqual(prepared());
    const read = { conversationId: id(2), manuscriptId: id(4), inputId: id(1), requestId: id(3) };
    expect(await gateway.readWritingQueued(read)).toEqual(prepared());
    expect(await gateway.settleWritingQueued(settle())).toEqual(settled());
    expect(invoke.mock.calls).toEqual([
      ["agent_prepare_writing_queued_compaction", { request: expectedRequest() }],
      ["agent_read_writing_queued_compaction", { request: read }],
      ["agent_settle_writing_queued_compaction", { request: settle() }],
    ]);
  });
  it("keeps discovery and exact-R lookup distinct, including ordinary purpose", async () => {
    const ordinary = { schemaVersion: 1, kind: "submission", preview: { schemaVersion: 1, inputId: id(1), preview: prepared().preview, queue: prepared().queue } };
    const gateway = createAgentCompactionGateway(async () => ordinary);
    const read = { conversationId: id(2), manuscriptId: id(4), inputId: id(1), requestId: null };
    expect(await gateway.readWritingQueued(read)).toEqual(ordinary);
    await expect(gateway.readWritingQueued({ ...read, requestId: id(99) })).rejects.toThrow();
    expect(await createAgentCompactionGateway(async () => null).readWritingQueued({ ...read, requestId: id(99) })).toBeNull();
    const historical = { ...prepared(), current: false, outcome: "failed" };
    expect(await createAgentCompactionGateway(async () => historical).readWritingQueued({ ...read, requestId: id(3) })).toEqual(historical);
  });
  it("checks the claimed queue, scope, frozen W and selected model", async () => {
    const original = prepared();
    const changed: unknown[] = [
      { ...original, inputId: id(99) }, { ...original, requestId: id(99) }, { ...original, claimRevision: 5 },
      { ...original, expectedRevision: 18 }, { ...original, queue: { ...original.queue, revision: 6 } },
      { ...original, preview: { ...original.preview, conversationId: id(99) } },
      { ...original, preview: { ...original.preview, manuscriptId: id(99) } },
      { ...original, queue: { ...original.queue, preparingInputId: null } },
    ];
    for (const response of changed) await expect(createAgentCompactionGateway(async () => response).prepareWritingQueued(request())).rejects.toThrow();
    await expect(createAgentCompactionGateway(async () => original).prepareWritingQueued({ ...request(),
      submission: { ...request().submission, model: { providerId: "other", modelId: "other" } } })).rejects.toThrow();
  });
  it("freezes full preparation before I/O and never retries transport failures", async () => {
    let finish!: (value: unknown) => void;
    const invoke = vi.fn(() => new Promise<unknown>(resolve => { finish = resolve; }));
    const original = request();
    const value = { ...request(), submission: { ...request().submission } };
    const pending = createAgentCompactionGateway(invoke).prepareWritingQueued(value);
    value.expectedRevision = 99; value.submission.text = "new draft";
    finish(prepared());
    expect(await pending).toEqual(prepared());
    expect(invoke).toHaveBeenCalledExactlyOnceWith("agent_prepare_writing_queued_compaction", { request: expectedRequest() });
    const unknown = { code: "AGENT_SQL_OUTCOME_UNKNOWN", operationId: id(3) };
    const unavailable = vi.fn(async () => { throw unknown; });
    await expect(createAgentCompactionGateway(unavailable).prepareWritingQueued(original)).rejects.toBe(unknown);
    expect(unavailable).toHaveBeenCalledTimes(1);
  });
  it("accepts only terminal settlement and verifies its removal or release proof", async () => {
    for (const outcome of ["completed", "failed", "canceled", "interrupted"] as const) {
      expect(await createAgentCompactionGateway(async () => settled(outcome)).settleWritingQueued(settle())).toEqual(settled(outcome));
    }
    for (const response of [
      { ...settled(), outcome: null }, { ...settled(), requestId: id(99) }, { ...settled(), inputId: id(99) },
      { ...settled(), queue: { ...settled().queue, revision: 11 } },
      { ...settled(), queue: { ...settled().queue, inputs: prepared().queue.inputs } },
      { ...settled("failed"), queue: { ...settled("failed").queue, paused: false } },
      { ...settled("failed"), queue: { ...settled("failed").queue, preparingInputId: id(1) } },
    ]) await expect(createAgentCompactionGateway(async () => response).settleWritingQueued(settle())).rejects.toThrow();
  });
});

describe("queued compaction durable DTO", () => {
  it("accepts exact committed retirement without replacing the frozen preview queue", async () => {
    const value = retired();
    expect(decodeAgentWritingQueuedCompactionPreview(value)).toEqual(value);
    const invoke = vi.fn(async () => value);
    const read = {conversationId: id(2), manuscriptId: id(4), inputId: id(1), requestId: id(3)};
    expect(await createAgentCompactionGateway(invoke).readWritingQueued(read)).toEqual(value);
    expect(invoke).toHaveBeenCalledExactlyOnceWith("agent_read_writing_queued_compaction", {request: read});
    expect(value.queue.revision).toBe(5);
    expect(value.retirement?.status.queue.revision).toBe(10);
    await expect(createAgentCompactionGateway(async () => value).prepareWritingQueued(request())).rejects.toThrow();
  });
  it("rejects retirement with an active or terminal task, a foreign identity or incomplete proof", () => {
    const value = retired(), proof = value.retirement!;
    for (const changed of [
      {...value, current: true}, {...value, outcome: "failed"}, {...value, retirement: undefined},
      {...value, retirement: {...proof, status: {type: "notFound"}}},
      {...value, retirement: {...proof, intent: {...proof.intent, inputId: id(99)}}},
      {...value, retirement: {...proof, intent: {...proof.intent, previewRequestId: id(99)}}},
      {...value, retirement: {...proof, intent: {...proof.intent, conversationId: id(99)}}},
      {...value, retirement: {...proof, intent: {...proof.intent, manuscriptId: id(99)}}},
      {...value, retirement: {...proof, intent: {...proof.intent, expectedRevision: 3}, status: {...proof.status,
        queue: {...proof.status.queue, revision: 4}}}},
      {...value, retirement: {...proof, status: {...proof.status, proof: {...proof.status.proof, operationId: id(99)}}}},
      {...value, retirement: {...proof, status: {...proof.status, proof: {...proof.status.proof, family: "other"}}}},
    ]) expect(() => decodeAgentWritingQueuedCompactionPreview(changed)).toThrow();
    for (const key of Object.keys(proof)) {
      const partial: Record<string, unknown> = {...proof}; delete partial[key];
      expect(() => decodeAgentWritingQueuedCompactionPreview({...value, retirement: partial})).toThrow();
    }
  });
  it("preserves source intent and model choice without inventing model policy", () => {
    const value = { ...request(), previousRequestId: id(10), submission: { ...request().submission,
      model: { providerId: " unreviewed ", modelId: "", reasoningEffort: null },
      context: { manuscriptId: id(4), files: [{ relativePath: "main.tex", expectedDiskSha256: "frozen", buffer: { revision: id(11), text: "original buffer" }, selection: { startUtf16: 0, endUtf16: 9 } }] } } };
    expect(decodeAgentWritingQueuedCompactionPrepareRequest(value)).toEqual({ ...value, submission: { ...value.submission,
      userInput: [], resources: [], retrieval: null, sessionConfig: null, turnConfig: null,
      model: { ...value.submission.model, serviceTier: null } } });
    for (const current of [true, false]) for (const outcome of [null, "completed", "failed", "canceled", "interrupted"] as const)
      expect(decodeAgentWritingQueuedCompactionPreview({ ...prepared(), current, outcome })).toMatchObject({ current, outcome });
  });
  it("rejects incomplete persisted intents, unsafe revisions and extra ownership fields", () => {
    for (const value of [
      { ...request(), expectedQueueRevision: Number.MAX_SAFE_INTEGER }, { ...request(), expectedRevision: -1 },
      { ...request(), inputId: "bad-id" }, { ...request(), previousRequestId: undefined },
      { ...request(), submission: { ...request().submission, context: { manuscriptId: id(4), files: [{ relativePath: "main.tex" }] } } },
      { ...request(), submission: { ...request().submission, strategy: "renderer-owned" } },
    ]) expect(() => decodeAgentWritingQueuedCompactionPrepareRequest(value)).toThrow();
  });
});
