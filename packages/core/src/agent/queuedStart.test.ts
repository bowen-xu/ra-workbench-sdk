import {expect, it} from "vitest";
import {decodeAgentWritingQueuedStartRequest, decodeAgentWritingQueuedStartStatusResponse, sameAgentWritingQueuedStartRequest} from "./queuedStart";
import type {AgentWritingQueuedStartRequest} from "./submission";

const id = (n: number) => `abcdef00-1234-5678-abcd-${String(n).padStart(12, "0")}`;
const intent = (): AgentWritingQueuedStartRequest => ({inputId: id(1), expectedRevision: 8, start: {conversationId: id(2), manuscriptId: id(3), requestId: id(4),
  contextSnapshotId: id(5), model: {providerId: "retired-provider", modelId: "custom-model", revision: "frozen-revision"}, mode: "chatGptDefault"}});
const preview = () => ({schemaVersion: 1, conversationId: id(2), manuscriptId: id(3), requestId: id(4), contextSnapshotId: id(5), turnId: id(6),
  input: {text: "original input", model: intent().start.model, reasoningEffort: null, context: []}});
const started = () => ({schemaVersion: 1, conversationId: id(2), requestId: id(4), turnId: id(6), alreadyStarted: true, outcome: null});
const detail = () => ({operationId: id(4), epoch: null, sqlFence: null, phase: "queued-start-status", sqliteCode: null, sqliteExtendedCode: null, safeCause: "queue_start_reader_unavailable"});

it("normalizes native UUID forms and absent model revision without selecting a current provider/profile", () => {
  const raw = {inputId: `urn:uuid:${id(1).toUpperCase()}`, expectedRevision: 0, start: {conversationId: id(2).toUpperCase(), manuscriptId: `{${id(3).toUpperCase()}}`,
    requestId: id(4).replaceAll("-", "").toUpperCase(), contextSnapshotId: `urn:uuid:${id(5)}`, model: {providerId: "retired-provider", modelId: "custom-model"}, mode: "chatGptDefault"}};
  const expected = {...intent(), expectedRevision: 0, start: {...intent().start, model: {providerId: "retired-provider", modelId: "custom-model", revision: null}}};
  expect(decodeAgentWritingQueuedStartRequest(raw)).toEqual(expected);
  expect(sameAgentWritingQueuedStartRequest(decodeAgentWritingQueuedStartRequest(raw), expected)).toBe(true);
  for (const mode of ["chatGptDefault", "deepSeekNonThinking"] as const)
    expect(decodeAgentWritingQueuedStartRequest({...intent(), start: {...intent().start, mode, model: {providerId: "", modelId: "", revision: null}}}).start.model).toEqual({providerId: "", modelId: "", revision: null});
});
it("retains the complete execution intent rather than matching only R", () => {
  const original = intent();
  const changes = [{...original, inputId: id(9)}, {...original, expectedRevision: 9}, ...[
    {conversationId: id(9)}, {manuscriptId: id(9)}, {requestId: id(9)}, {contextSnapshotId: id(9)}, {mode: "deepSeekNonThinking" as const},
    {model: {...original.start.model, providerId: "other-provider"}}, {model: {...original.start.model, modelId: "other-model"}}, {model: {...original.start.model, revision: "other-revision"}},
  ].map(patch => ({...original, start: {...original.start, ...patch}}))];
  for (const changed of changes) expect(sameAgentWritingQueuedStartRequest(original, changed)).toBe(false);
});
it("rejects nil identities and unsafe queue revisions at the Native boundary", () => {
  const nil = "00000000-0000-0000-0000-000000000000";
  for (const value of [{...intent(), inputId: `{${nil}}`}, ...["conversationId", "manuscriptId", "requestId", "contextSnapshotId"].map(key => ({...intent(), start: {...intent().start, [key]: `urn:uuid:${nil}`}}))])
    expect(() => decodeAgentWritingQueuedStartRequest(value)).toThrow();
  for (const expectedRevision of [-1, 0.5, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1, Number.NaN, Number.POSITIVE_INFINITY, "18446744073709551615", 18446744073709551615n, null])
    expect(() => decodeAgentWritingQueuedStartRequest({...intent(), expectedRevision})).toThrow();
  for (const expectedRevision of [0, Number.MAX_SAFE_INTEGER - 1]) expect(decodeAgentWritingQueuedStartRequest({...intent(), expectedRevision}).expectedRevision).toBe(expectedRevision);
});
it("matches Native deny-unknown-fields and mode enum without imposing provider policy", () => {
  for (const value of [{...intent(), turnId: id(6)}, {...intent(), start: {...intent().start, turnId: id(6)}},
    {...intent(), start: {...intent().start, model: {...intent().start.model, reasoningEffort: "high"}}},
    ...[null, "chatgptDefault", "future-mode", 0].map(mode => ({...intent(), start: {...intent().start, mode}}))])
    expect(() => decodeAgentWritingQueuedStartRequest(value)).toThrow();
});
it.each(["prepared", "admitted"])("reads %s for the exact frozen record, including retired/custom model identities", type => {
  expect(decodeAgentWritingQueuedStartStatusResponse({schemaVersion: 1, intent: intent(), status: {type, preview: preview()}})).toEqual({schemaVersion: 1, intent: intent(), status: {type, preview: preview()}});
  const original = preview();
  for (const changed of [{...original, conversationId: id(9)}, {...original, manuscriptId: id(9)}, {...original, requestId: id(9)}, {...original, contextSnapshotId: id(9)},
    ...[{providerId: "changed"}, {modelId: "changed"}, {revision: "changed"}].map(patch => ({...original, input: {...original.input, model: {...original.input.model, ...patch}}}))])
    expect(() => decodeAgentWritingQueuedStartStatusResponse({schemaVersion: 1, intent: intent(), status: {type, preview: changed}})).toThrow();
});
it.each([null, "completed", "failed", "canceled", "interrupted"])("reads an observed started result with outcome %s without requiring a workspace or current preview", outcome => {
  const result = {...started(), outcome};
  expect(decodeAgentWritingQueuedStartStatusResponse({schemaVersion: 1, intent: intent(), status: {type: "started", result}})).toEqual({schemaVersion: 1, intent: intent(), status: {type: "started", result}});
  // Expected T belongs to the local owner, not to the queued-start request.
  expect(decodeAgentWritingQueuedStartStatusResponse({schemaVersion: 1, intent: intent(), status: {type: "started", result: {...result, turnId: id(99)}}}).status.type).toBe("started");
});
it("rejects a claimed started fact that is not alreadyStarted or belongs to a foreign C/R", () => {
  for (const patch of [{alreadyStarted: false}, {conversationId: id(9)}, {requestId: id(9)}, {outcome: "unknown"}])
    expect(() => decodeAgentWritingQueuedStartStatusResponse({schemaVersion: 1, intent: intent(), status: {type: "started", result: {...started(), ...patch}}})).toThrow();
});
it("preserves only the seven safe Unconfirmed fields and their original operation identity", () => {
  const diagnostic = {...detail(), epoch: id(10), sqlFence: "18446744073709551615", sqliteCode: "DatabaseBusy", sqliteExtendedCode: 517};
  expect(decodeAgentWritingQueuedStartStatusResponse({schemaVersion: 1, intent: intent(), status: {type: "unconfirmed", detail: diagnostic}}).status).toEqual({type: "unconfirmed", detail: diagnostic});
  const fields = ["operationId", "epoch", "sqlFence", "phase", "sqliteCode", "sqliteExtendedCode", "safeCause"];
  for (const missing of fields) {
    const changed: Record<string, unknown> = {...detail()}; delete changed[missing];
    expect(() => decodeAgentWritingQueuedStartStatusResponse({schemaVersion: 1, intent: intent(), status: {type: "unconfirmed", detail: changed}})).toThrow();
  }
  for (const patch of [{operationId: id(9)}, {epoch: 7}, {sqlFence: "18446744073709551616"}, {sqliteCode: "raw SQL here"}, {sqliteExtendedCode: -1}, {phase: null}, {safeCause: "raw private body"}, {rawSql: "private"}])
    expect(() => decodeAgentWritingQueuedStartStatusResponse({schemaVersion: 1, intent: intent(), status: {type: "unconfirmed", detail: {...detail(), ...patch}}})).toThrow();
});
it("does not reinterpret status observations as typed mode or SQL mutation proofs", () => {
  expect(decodeAgentWritingQueuedStartStatusResponse({schemaVersion: 1, intent: intent(), status: {type: "notFound"}}).status).toEqual({type: "notFound"});
  for (const status of [{type: "committed", proof: {}}, {type: "prepared", preview: preview(), proof: {}}, {type: "admitted", preview: preview(), result: started()},
    {type: "started", result: started(), preview: preview()}, {type: "notFound", detail: detail()}])
    expect(() => decodeAgentWritingQueuedStartStatusResponse({schemaVersion: 1, intent: intent(), status})).toThrow();
});
