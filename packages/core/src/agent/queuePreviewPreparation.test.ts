import {expect, it} from "vitest";
import {decodeAgentWritingQueuePreviewRequest, decodeAgentWritingQueuePrepareStatusResponse, sameAgentWritingQueuePreviewRequest} from "./queuePreviewPreparation";
const id = (n: number) => `abcdef00-1234-5678-abcd-${String(n).padStart(12, "0")}`;
const request = {inputId: id(1), expectedRevision: 8, submission: {conversationId: id(2), requestId: id(3), text: "question",
  context: {manuscriptId: id(4), files: [{relativePath: "main.tex", expectedDiskSha256: "hash"}]}}};
const canonical = () => decodeAgentWritingQueuePreviewRequest(request);
const result = () => ({schemaVersion: 1, inputId: id(1), preview: {schemaVersion: 1, conversationId: id(2), requestId: id(3), manuscriptId: id(4),
  turnId: id(5), contextSnapshotId: id(6), input: {text: "question", model: {providerId: "provider", modelId: "model", revision: null}, reasoningEffort: null, context: []}},
  queue: {schemaVersion: 1, conversationId: id(2), manuscriptId: id(4), revision: 9, paused: false, preparingInputId: id(1), inputs: [{inputId: id(1), text: "question"}]}});
const proof = () => ({schemaVersion: 1, operationId: id(3), conversationId: id(2), family: "agent.queue.preview.prepare", epoch: id(7), sqlFence: "9007199254740993", replayed: true, result: null});
it("normalizes native defaults without choosing a model or changing input authority", () => {
  const value = canonical();
  expect(value.submission).toMatchObject({userInput: [], resources: [], model: null, retrieval: null, sessionConfig: null, turnConfig: null,
    context: {files: [{buffer: null, selection: null}]}});
  expect(sameAgentWritingQueuePreviewRequest(request, value)).toBe(true);
  const model = decodeAgentWritingQueuePreviewRequest({...request, submission: {...request.submission, model: {providerId: "any", modelId: "any"}}});
  expect(model.submission.model).toEqual({providerId: "any", modelId: "any", reasoningEffort: null, serviceTier: null});
  expect(() => decodeAgentWritingQueuePreviewRequest({...request, submission: {...request.submission, userInput: null}})).toThrow();
});
it("matches native UUID spellings, legacy mention serialization and annotation defaults", () => {
  const address = `source://writings/${id(4)}/./%6dain.tex`;
  const value = decodeAgentWritingQueuePreviewRequest({...request, inputId: `urn:uuid:${id(1).toUpperCase()}`, submission: {...request.submission,
    userInput: [{type: "text", text: "question"}, {type: "mention", name: "file", target: {kind: "file", sourceId: "source", resourceId: "file", revision: "legacy", sourceUrl: address}},
      {type: "selection", source: `source://writings/${id(4)}/main.tex`, title: "quote", text: "captured", image: null, displayText: null}],
    context: {manuscriptId: id(4), files: [{relativePath: "main.tex", expectedDiskSha256: "hash", buffer: {revision: `{${id(9).toUpperCase()}}`, text: "buffer"}}]}}});
  expect(value.inputId).toBe(id(1)); expect(value.submission.context.files[0]?.buffer?.revision).toBe(id(9));
  expect(value.submission.userInput).toEqual([{type: "text", text: "question", textElements: []}, {type: "mention", name: "file", target: {kind: "file", sourceId: "source", resourceId: "file", sourceUrl: address}},
    {type: "annotation", source: `source://writings/${id(4)}/main.tex`, title: "quote", text: "captured", comment: ""}]);
});
it("does not convert explicit null into a nonoptional native default or hide an unknown null field", () => {
  for (const userInput of [[{type: "text", text: "question", textElements: null}], [{type: "text", text: "question"},
    {type: "annotation", source: `source://writings/${id(4)}/main.tex`, title: "quote", text: "captured", comment: null}]])
    expect(() => decodeAgentWritingQueuePreviewRequest({...request, submission: {...request.submission, userInput}})).toThrow();
  expect(() => decodeAgentWritingQueuePreviewRequest({...request, submission: {...request.submission, resources: [{kind: "note", resourceId: id(9), attachmentId: null}]}})).toThrow();
});
it("compares the whole immutable intent including resource permissions, buffers, selections and model options", () => {
  const original = canonical();
  const changes = [
    {...original, expectedRevision: 9}, {...original, inputId: id(9)},
    {...original, submission: {...original.submission, resources: [{kind: "structuredObject" as const, resourceId: "object", access: "readOnly" as const}]}},
    {...original, submission: {...original.submission, retrieval: {traceId: "trace", query: "query"}}},
    {...original, submission: {...original.submission, model: {providerId: "p", modelId: "m", serviceTier: "default" as const}}},
    {...original, submission: {...original.submission, context: {...original.submission.context, files: [{relativePath: "main.tex", expectedDiskSha256: "hash", selection: {startUtf16: 0, endUtf16: 1}}]}}},
  ];
  for (const changed of changes) expect(sameAgentWritingQueuePreviewRequest(original, changed)).toBe(false);
});
it("decodes historical committed proof and rejects foreign operation, family, queue or result", () => {
  const response = {schemaVersion: 1, intent: request, status: {type: "committed", proof: proof(), result: result()}};
  expect(decodeAgentWritingQueuePrepareStatusResponse(response)).toMatchObject({intent: canonical(), status: {type: "committed", result: result()}});
  for (const patch of [{operationId: id(9)}, {conversationId: id(9)}, {family: "agent.queue.preview.cancel"}, {result: {}}, {sqlFence: "01"}])
    expect(() => decodeAgentWritingQueuePrepareStatusResponse({...response, status: {...response.status, proof: {...proof(), ...patch}}})).toThrow();
  expect(() => decodeAgentWritingQueuePrepareStatusResponse({...response, status: {...response.status, result: {...result(), queue: {...result().queue, revision: 10}}}})).toThrow();
});
it("requires exact safe diagnostic identity for unconfirmed status", () => {
  const detail = {operationId: id(3), epoch: null, sqlFence: null, phase: "commit", sqliteCode: null, sqliteExtendedCode: null, safeCause: "sql_commit_outcome_unknown"};
  expect(decodeAgentWritingQueuePrepareStatusResponse({schemaVersion: 1, intent: request, status: {type: "unconfirmed", detail}}).status).toEqual({type: "unconfirmed", detail});
  expect(() => decodeAgentWritingQueuePrepareStatusResponse({schemaVersion: 1, intent: request, status: {type: "unconfirmed", detail: {...detail, operationId: id(8)}}})).toThrow();
});
