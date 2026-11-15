import {expect, it, vi} from "vitest";
import {decodeAgentWritingQueuedStartRequest, type AgentWritingQueuedStartRequest} from "@research-assistant/core/agent";
import {createAgentInputQueuePreviewGateway} from "./inputQueuePreview";

const id = (n: number) => `abcdef00-1234-5678-abcd-${String(n).padStart(12, "0")}`;
const intent = (): AgentWritingQueuedStartRequest => ({inputId: id(1), expectedRevision: 8, start: {conversationId: id(2), manuscriptId: id(3), requestId: id(4), contextSnapshotId: id(5),
  model: {providerId: "retired-provider", modelId: "custom-model", revision: null}, mode: "chatGptDefault"}});
const result = () => ({schemaVersion: 1, conversationId: id(2), requestId: id(4), turnId: id(6), alreadyStarted: false, outcome: null});

it("freezes the entire first actual start request before transport and uses a separate readonly status RPC", async () => {
  const invoke = vi.fn(async (command: string, _args: Record<string, unknown>) => command === "agent_start_writing_queued_submission" ? result() : {schemaVersion: 1, intent: intent(), status: {type: "notFound"}});
  const gateway = createAgentInputQueuePreviewGateway(invoke), input = structuredClone(intent()), expected = decodeAgentWritingQueuedStartRequest(input);
  const work = gateway.start(input);
  const changed = input as {inputId: string; expectedRevision: number; start: {conversationId: string; manuscriptId: string; requestId: string; contextSnapshotId: string; model: {providerId: string; modelId: string; revision: string | null}; mode: string}};
  changed.inputId = id(91); changed.expectedRevision = 90; changed.start.conversationId = id(92); changed.start.manuscriptId = id(93); changed.start.requestId = id(94);
  changed.start.contextSnapshotId = id(95); changed.start.model.providerId = "changed"; changed.start.model.modelId = "changed"; changed.start.model.revision = "changed"; changed.start.mode = "deepSeekNonThinking";
  expect(await work).toEqual(result()); await gateway.startStatus(intent());
  expect(invoke.mock.calls).toEqual([["agent_start_writing_queued_submission", {request: expected}], ["agent_read_writing_queued_start_status", {request: expected}]]);
});
it("normalizes the echoed full intent before comparing missing revision/null and UUID spellings", async () => {
  const request = intent(), echo = {...request, inputId: `urn:uuid:${id(1).toUpperCase()}`, start: {...request.start, conversationId: id(2).toUpperCase(),
    manuscriptId: `{${id(3).toUpperCase()}}`, requestId: id(4).replaceAll("-", "").toUpperCase(), contextSnapshotId: `urn:uuid:${id(5)}`, model: {providerId: "retired-provider", modelId: "custom-model"}}};
  const gateway = createAgentInputQueuePreviewGateway(async () => ({schemaVersion: 1, intent: echo, status: {type: "notFound"}}));
  expect(await gateway.startStatus(request)).toEqual({schemaVersion: 1, intent: request, status: {type: "notFound"}});
});
it("rejects a foreign complete status intent even when its own status is internally valid", async () => {
  const original = intent();
  const changes = [{...original, inputId: id(9)}, {...original, expectedRevision: 9}, ...[
    {conversationId: id(9)}, {manuscriptId: id(9)}, {requestId: id(9)}, {contextSnapshotId: id(9)}, {mode: "deepSeekNonThinking" as const},
    {model: {...original.start.model, providerId: "other"}}, {model: {...original.start.model, modelId: "other"}}, {model: {...original.start.model, revision: "other"}},
  ].map(patch => ({...original, start: {...original.start, ...patch}}))];
  for (const changed of changes) {
    const invoke = vi.fn(async () => ({schemaVersion: 1, intent: changed, status: {type: "notFound"}}));
    await expect(createAgentInputQueuePreviewGateway(invoke).startStatus(original)).rejects.toThrow(); expect(invoke).toHaveBeenCalledOnce();
  }
});
it("checks the C/R of a start acknowledgment while leaving original turn validation to the owner", async () => {
  for (const patch of [{conversationId: id(9)}, {requestId: id(9)}])
    await expect(createAgentInputQueuePreviewGateway(async () => ({...result(), ...patch})).start(intent())).rejects.toThrow();
  expect(await createAgentInputQueuePreviewGateway(async () => ({...result(), turnId: id(99)})).start(intent())).toMatchObject({turnId: id(99)});
});
it("started status remains readonly for completed history and never calls a model, preparation or workspace command", async () => {
  const observed = {...result(), alreadyStarted: true, outcome: "completed"};
  const invoke = vi.fn(async (_command: string, _args: Record<string, unknown>) => ({schemaVersion: 1, intent: intent(), status: {type: "started", result: observed}}));
  expect(await createAgentInputQueuePreviewGateway(invoke).startStatus(intent())).toEqual({schemaVersion: 1, intent: intent(), status: {type: "started", result: observed}});
  expect(invoke).toHaveBeenCalledExactlyOnceWith("agent_read_writing_queued_start_status", {request: intent()});
});
it.each([{code: "preparation", reason: "conflict"}, {code: "recoveryRequired"}, {code: "storage", reason: {operationId: id(4), code: "DATA_SQL_RECOVERY_REQUIRED", safeCause: "sql_recovery_required"}},
  "AGENT_PREVIEW_RAW_PLAN_REQUIRED"])("propagates the original Native failure shape without implicit retries", async cause => {
  const invoke = vi.fn(async (_command: string, _args: Record<string, unknown>) => {throw cause;}), gateway = createAgentInputQueuePreviewGateway(invoke);
  await expect(gateway.start(intent())).rejects.toBe(cause); await expect(gateway.startStatus(intent())).rejects.toBe(cause);
  expect(invoke.mock.calls.map(([command]) => command)).toEqual(["agent_start_writing_queued_submission", "agent_read_writing_queued_start_status"]);
});
it("invalid complete requests fail before transport rather than leaking extra local metadata to Native", async () => {
  const invoke = vi.fn(async () => null), gateway = createAgentInputQueuePreviewGateway(invoke);
  await expect(gateway.start({...intent(), expectedRevision: Number.MAX_SAFE_INTEGER})).rejects.toThrow();
  await expect(gateway.startStatus({...intent(), start: {...intent().start, mode: "future-mode" as never}})).rejects.toThrow();
  expect(invoke).not.toHaveBeenCalled();
});
