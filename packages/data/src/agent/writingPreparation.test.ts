import {expect, it, vi} from "vitest";
import golden from "../../../../tests/fixtures/agent-writing-prepare-native-v1.json";
import {decodeAgentWritingPrepareRequest, decodeAgentWritingCompactionPrepareRequest,
  decodeAgentSqlImmediateFailure} from "@research-assistant/core/agent";
import {createAgentSubmissionGateway} from "./submission";
import {createAgentCompactionGateway} from "./compaction";

const other = "abcdef00-1234-5678-abcd-000000000009";
const request = () => decodeAgentWritingPrepareRequest(golden.ordinary.intent);
const compact = () => decodeAgentWritingCompactionPrepareRequest(golden.compact.intent);
it("uses one read-only ordinary status RPC with the whole original request and real native result", async () => {
  const invoke = vi.fn(async (_command: string, _args: Record<string, unknown>): Promise<unknown> => golden.ordinary);
  const value = await createAgentSubmissionGateway(invoke).prepareWritingStatus(request());
  expect(value.status).toMatchObject({type: "committed", proof: {sqlFence: "0", result: null}});
  expect(invoke).toHaveBeenCalledExactlyOnceWith("agent_read_writing_submission_prepare_status", {request: request()});
});
it("freezes the complete ordinary intent before transport, even when its caller changes buffers and text", async () => {
  let finish!: (value: unknown) => void;
  const invoke = vi.fn(async (_command: string, _args: Record<string, unknown>): Promise<unknown> => new Promise(resolve => {finish = resolve;}));
  const original = request(), caller = {...original, context: {...original.context, files: original.context.files.map(file => ({...file, buffer: {revision: other, text: "original buffer"}}))}};
  const expected = decodeAgentWritingPrepareRequest(caller), work = createAgentSubmissionGateway(invoke).prepareWritingStatus(caller);
  caller.text = "later text"; caller.context.files[0]!.buffer.text = "later buffer"; caller.context.manuscriptId = other;
  finish({schemaVersion: 1, intent: expected, status: {type: "notFound"}}); expect((await work).intent).toEqual(expected);
  expect(invoke).toHaveBeenCalledExactlyOnceWith("agent_read_writing_submission_prepare_status", {request: expected});
});
it("uses the exact manual request and original W as separate native arguments, with no implicit start or restore", async () => {
  const invoke = vi.fn(async (_command: string, _args: Record<string, unknown>): Promise<unknown> => golden.compact);
  expect((await createAgentCompactionGateway(invoke).prepareWritingStatus(compact())).status.type).toBe("committed");
  const original = compact(); expect(invoke).toHaveBeenCalledExactlyOnceWith("agent_read_writing_compaction_prepare_status", {request: original.request, expectedRevision: original.expectedRevision});
});
it("does not accept a different complete ordinary echo even when its NotFound result is valid", async () => {
  const original = request();
  for (const changed of [{...original, text: "later"}, {...original, requestId: other}, {...original, conversationId: other},
    {...original, context: {...original.context, manuscriptId: other}}, {...original, model: {providerId: "p", modelId: "m"}},
    {...original, retrieval: {traceId: "later-trace", query: "later-query"}}, {...original, resources: []}]) {
    const invoke = vi.fn(async (): Promise<unknown> => ({schemaVersion: 1, intent: changed, status: {type: "notFound"}}));
    await expect(createAgentSubmissionGateway(invoke).prepareWritingStatus(original)).rejects.toThrow(); expect(invoke).toHaveBeenCalledOnce();
  }
});
it("a newer manual W or changed body cannot replace the original intent in an otherwise valid response", async () => {
  const original = compact();
  for (const changed of [{...original, expectedRevision: original.expectedRevision + 1}, {...original, request: {...original.request, text: " /compact "}}]) {
    const invoke = vi.fn(async (): Promise<unknown> => ({schemaVersion: 1, intent: changed, status: {type: "notFound"}}));
    await expect(createAgentCompactionGateway(invoke).prepareWritingStatus(original)).rejects.toThrow(); expect(invoke).toHaveBeenCalledOnce();
  }
});
it("passes real native Unconfirmed and structured storage diagnostics without executing preparation again", async () => {
  const invoke = vi.fn(async (_command: string, _args: Record<string, unknown>): Promise<unknown> => golden.unconfirmed);
  expect((await createAgentSubmissionGateway(invoke).prepareWritingStatus(request())).status).toEqual(golden.unconfirmed.status);
  expect(invoke).toHaveBeenCalledOnce(); invoke.mockRejectedValueOnce(golden.storageFailure);
  let failure: unknown; try {await createAgentSubmissionGateway(invoke).prepareWritingStatus(request());} catch (cause: unknown) {failure = cause;}
  expect(failure).toBe(golden.storageFailure); expect(invoke).toHaveBeenCalledTimes(2);
  expect(decodeAgentSqlImmediateFailure(failure)).toMatchObject({diagnostic: {operationId: request().requestId, sqliteCode: "Unknown", sqliteExtendedCode: 1}});
});
it("ordinary and manual prepare writes each retain their original native shape and validated frozen scope", async () => {
  const ordinaryInvoke = vi.fn(async (_command: string, _args: Record<string, unknown>): Promise<unknown> => golden.ordinary.status.result);
  expect((await createAgentSubmissionGateway(ordinaryInvoke).prepareWriting(request())).input.text).toBe(request().text);
  expect(ordinaryInvoke).toHaveBeenCalledExactlyOnceWith("agent_prepare_writing_submission", {request: request()});
  const manualInvoke = vi.fn(async (_command: string, _args: Record<string, unknown>): Promise<unknown> => golden.compact.status.result);
  expect((await createAgentCompactionGateway(manualInvoke).prepareWriting(compact())).expectedRevision).toBe(compact().expectedRevision);
  expect(manualInvoke).toHaveBeenCalledExactlyOnceWith("agent_prepare_writing_compaction", {request: compact().request, expectedRevision: compact().expectedRevision});
});
