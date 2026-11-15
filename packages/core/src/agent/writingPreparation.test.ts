import {expect, it} from "vitest";
import golden from "../../../../tests/fixtures/agent-writing-prepare-native-v1.json";
import {decodeAgentWritingPrepareRequest} from "./queuePreviewPreparation";
import {decodeAgentSqlImmediateFailure} from "./sqlImmediateDiagnostic";
import {decodeAgentWritingPrepareResult, decodeAgentWritingPrepareStatusResponse,
  decodeAgentWritingCompactionPrepareRequest, decodeAgentWritingCompactionPrepareStatusResponse,
  sameAgentWritingPrepareRequest, sameAgentWritingCompactionPrepareRequest} from "./writingPreparation";

const other = "abcdef00-1234-5678-abcd-000000000009";
const request = () => decodeAgentWritingPrepareRequest(golden.ordinary.intent);
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const ordinary = () => copy(golden.ordinary);

it("decodes real native ordinary/manual serde output including supplemental grants, W0 and unit proof", () => {
  expect(decodeAgentWritingPrepareStatusResponse(golden.ordinary)).toMatchObject({intent: request(), status: {
    type: "committed", proof: {sqlFence: "0", result: null}, result: {input: {text: golden.ordinary.intent.text}},
  }});
  expect(decodeAgentWritingCompactionPrepareStatusResponse(golden.compact)).toMatchObject({intent: golden.compact.intent,
    status: {type: "committed", result: {expectedRevision: golden.compact.intent.expectedRevision}}});
  expect(decodeAgentWritingPrepareStatusResponse(golden.unconfirmed).status).toEqual(golden.unconfirmed.status);
  expect(decodeAgentSqlImmediateFailure(golden.storageFailure)).toMatchObject({code: "DATA_SQL_UNAVAILABLE", diagnostic: {
    operationId: golden.ordinary.intent.requestId, sqlFence: "0", sqliteCode: "Unknown", sqliteExtendedCode: 1,
  }});
});
it("canonicalizes native defaults and UUID spellings while preserving original source URL bytes", () => {
  const original = request(), address = `source://writings/${original.context.manuscriptId}/./%6dain.tex`;
  const minimal = {conversationId: `{${original.conversationId.toUpperCase()}}`, requestId: `urn:uuid:${original.requestId.toUpperCase()}`,
    text: original.text, context: original.context, userInput: [{type: "text", text: original.text},
      {type: "mention", name: "file", target: {kind: "file", sourceId: "source", resourceId: "file", sourceUrl: address, revision: "old-metadata"}}]};
  const normalized = decodeAgentWritingPrepareRequest(minimal);
  expect(normalized).toMatchObject({conversationId: original.conversationId, requestId: original.requestId,
    resources: [], model: null, retrieval: null, sessionConfig: null, turnConfig: null,
    userInput: [{type: "text", textElements: []}, {target: {sourceUrl: address}}]});
  expect(normalized.userInput?.[1]).not.toHaveProperty("target.revision");
});
it("compares the complete request rather than only R, including frozen buffers, resources and model settings", () => {
  const original = request(), file = original.context.files[0]!;
  const changes = [{...original, conversationId: other}, {...original, requestId: other}, {...original, text: "later text"},
    {...original, context: {...original.context, manuscriptId: other}},
    {...original, context: {...original.context, files: [{...file, buffer: {revision: other, text: "later buffer"}}]}},
    {...original, retrieval: {traceId: "later", query: "later query"}},
    {...original, resources: [{kind: "structuredObject" as const, resourceId: "object", access: "readWrite" as const}]},
    {...original, model: {providerId: "provider", modelId: "model", reasoningEffort: "low", serviceTier: "fast" as const}},
    {...original, sessionConfig: {maxBytes: 4096}}, {...original, turnConfig: {fallbackFilenames: ["README.md"]}}];
  for (const changed of changes) expect(sameAgentWritingPrepareRequest(original, changed)).toBe(false);
  expect(sameAgentWritingPrepareRequest(original, {...original, conversationId: original.conversationId.toUpperCase()})).toBe(true);
});
it("does not accept a proof for a different operation, family or noncanonical fence", () => {
  const value = ordinary();
  for (const patch of [{operationId: other}, {conversationId: other}, {family: "agent.queue.preview.prepare"},
    {schemaVersion: 2}, {result: {}}, {sqlFence: "01"}, {sqlFence: 0}, {epoch: "00000000-0000-0000-0000-000000000000"}])
    expect(() => decodeAgentWritingPrepareStatusResponse({...value, status: {...value.status, proof: {...value.status.proof, ...patch}}})).toThrow();
  for (const patch of [{conversationId: other}, {requestId: other}, {manuscriptId: other}])
    expect(() => decodeAgentWritingPrepareStatusResponse({...value, status: {...value.status, result: {...value.status.result, ...patch}}})).toThrow();
});
it("binds manual preparation to its original complete request and W, without borrowing a newer history fence", () => {
  const value = copy(golden.compact), original = decodeAgentWritingCompactionPrepareRequest(value.intent);
  expect(sameAgentWritingCompactionPrepareRequest(original, {...original, expectedRevision: original.expectedRevision + 1})).toBe(false);
  expect(sameAgentWritingCompactionPrepareRequest(original, {...original, request: {...original.request, text: " /compact "}})).toBe(false);
  expect(() => decodeAgentWritingCompactionPrepareStatusResponse({...value, status: {...value.status,
    result: {...value.status.result, expectedRevision: original.expectedRevision + 1}}})).toThrow();
  for (const expectedRevision of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1])
    expect(() => decodeAgentWritingCompactionPrepareRequest({...original, expectedRevision})).toThrow();
});
it("rejects empty or unmarked foreign source scope and malformed anchors", () => {
  const value = ordinary(), source = value.status.result.input.context[0]!;
  for (const context of [[], [{...source, anchor: null}], [{...source, anchor: "[]"}],
    [{...source, anchor: JSON.stringify({manuscriptId: other})}], [{...source, kind: "note", anchor: JSON.stringify({manuscriptId: value.intent.context.manuscriptId})}]])
    expect(() => decodeAgentWritingPrepareResult({...value.status.result, input: {...value.status.result.input, context}}, request())).toThrow();
});
it("accepts a genuine supplemental-only grant without requiring a primary file", () => {
  const value = ordinary(), grant = value.status.result.input.context[1]!;
  expect(decodeAgentWritingPrepareResult({...value.status.result, input: {...value.status.result.input, context: [grant]}}, request()).input.context).toHaveLength(1);
  expect(() => decodeAgentWritingPrepareResult({...value.status.result, input: {...value.status.result.input,
    context: [{...grant, revision: "grant:foreign"}]}}, request())).toThrow();
});
it("accepts the native same-manuscript materialized supplemental-file form as well as resource grants", () => {
  const value = ordinary(), source = value.status.result.input.context[0]!;
  const context = [{...source, anchor: JSON.stringify({...JSON.parse(source.anchor), supplementalContext: true})}];
  expect(decodeAgentWritingPrepareResult({...value.status.result, input: {...value.status.result.input, context}}, request()).input.context).toHaveLength(1);
});
it("keeps all available safe diagnostic fields and rejects another operation or missing fields", () => {
  const value = copy(golden.unconfirmed), detail = value.status.detail;
  expect(decodeAgentWritingPrepareStatusResponse({...value, status: {type: "notFound"}}).status).toEqual({type: "notFound"});
  expect(() => decodeAgentWritingPrepareStatusResponse({...value, status: {type: "notFound", proof: golden.ordinary.status.proof}})).toThrow();
  expect(() => decodeAgentWritingPrepareStatusResponse({...value, status: {...value.status, detail: {...detail, operationId: other}}})).toThrow();
  for (const key of ["epoch", "sqlFence", "sqliteCode", "sqliteExtendedCode"]) {
    const changed: Record<string, unknown> = {...detail}; delete changed[key];
    expect(() => decodeAgentWritingPrepareStatusResponse({...value, status: {...value.status, detail: changed}})).toThrow();
  }
});
