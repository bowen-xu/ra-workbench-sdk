import {describe, expect, it} from "vitest";
import {decodeAgentPaperPrepareStatusResponse, sameAgentPaperPrepareRequest} from "./paperPreparationStatus";

const conversationId = "a1111111-1111-4111-8111-111111111111", requestId = "b1111111-1111-4111-8111-111111111111";
const other = "e1111111-1111-4111-8111-111111111111", epoch = "f1111111-1111-4111-8111-111111111111";
const intent = {conversationId, requestId, paperId: "paper", paperContextSnapshotId: "snapshot", expectedContextHash: "a".repeat(64), text: "Explain"};
const nativeIntent = {...intent, retrieval: null, userInput: [], model: null, sessionConfig: null, turnConfig: null};
const preview = {schemaVersion: 1, conversationId, requestId, paperId: "paper", paperContextSnapshotId: "snapshot",
  turnId: "c1111111-1111-4111-8111-111111111111", contextSnapshotId: "d1111111-1111-4111-8111-111111111111",
  input: {text: "Explain", model: {providerId: "deepseek", modelId: "example", revision: null}, reasoningEffort: null, context: []}};
const proof = {schemaVersion: 1, operationId: requestId, conversationId, family: "agent.paper.submission.prepare", epoch, sqlFence: "9007199254740993", replayed: true, result: null};
const diagnostic = {operationId: requestId, epoch, sqlFence: "0", phase: "paper-prepare-status", sqliteCode: null, sqliteExtendedCode: null, safeCause: "paper_prepare_worker_unconfirmed"};

describe("paper preparation status", () => {
  it("compares native defaults while retaining all original request fields", () => {
    expect(sameAgentPaperPrepareRequest(intent, nativeIntent)).toBe(true);
    for (const patch of [{requestId: other}, {paperId: "other"}, {expectedContextHash: "b".repeat(64)}, {text: "Changed"},
      {retrieval: {traceId: "trace", query: "query"}}, {sessionConfig: {maxBytes: 123}}])
      expect(sameAgentPaperPrepareRequest(intent, {...nativeIntent, ...patch})).toBe(false);
  });
  it("matches native omission of legacy file revision without losing the source identity", () => {
    const text = {type: "text" as const, text: intent.text, textElements: []};
    const mention = {type: "mention" as const, name: "file", target: {kind: "file" as const, sourceId: "source", resourceId: "file", revision: "legacy"}};
    const withRevision = {...intent, userInput: [text, mention]};
    const nativeMention = {...mention, target: {kind: "file" as const, sourceId: "source", resourceId: "file"}};
    const native = {...intent, userInput: [text, nativeMention]};
    expect(sameAgentPaperPrepareRequest(withRevision, native)).toBe(true);
    expect(sameAgentPaperPrepareRequest(withRevision, {...native, userInput: [text, {...nativeMention, target: {...nativeMention.target, resourceId: "other"}}]})).toBe(false);
  });
  it("accepts a bound committed fact and an unconfirmed missing receipt", () => {
    expect(decodeAgentPaperPrepareStatusResponse({schemaVersion: 1, intent: nativeIntent, status: {type: "committed", proof, result: preview}}).status)
      .toMatchObject({type: "committed", proof: {sqlFence: "9007199254740993"}, result: {turnId: preview.turnId}});
    expect(decodeAgentPaperPrepareStatusResponse({schemaVersion: 1, intent: nativeIntent, status: {type: "unconfirmed", detail: diagnostic}}).status)
      .toMatchObject({type: "unconfirmed", detail: diagnostic});
    expect(() => decodeAgentPaperPrepareStatusResponse({schemaVersion: 1, intent: nativeIntent, status: {type: "notFound"}})).toThrow();
  });
  it("accepts native null service tier on a selected model", () => {
    const selected = {...nativeIntent, model: {providerId: "deepseek", modelId: "example", reasoningEffort: null, serviceTier: null}};
    const response = decodeAgentPaperPrepareStatusResponse({schemaVersion: 1, intent: selected, status: {type: "committed", proof, result: preview}});
    expect(response.intent.model).toEqual({providerId: "deepseek", modelId: "example", reasoningEffort: null});
    expect(sameAgentPaperPrepareRequest(intent, response.intent)).toBe(false);
  });
  it("rejects mismatched proofs, results and incomplete diagnostics", () => {
    for (const patch of [{operationId: other}, {conversationId: other}, {family: "other"}, {sqlFence: "01"}, {epoch: "00000000-0000-0000-0000-000000000000"}, {result: {}}]) {
      const invalid = {...proof, ...patch};
      expect(() => decodeAgentPaperPrepareStatusResponse({schemaVersion: 1, intent: nativeIntent, status: {type: "committed", proof: invalid, result: preview}})).toThrow();
    }
    for (const patch of [{conversationId: other}, {requestId: other}, {paperId: "other"}, {paperContextSnapshotId: "other"}, {input: {...preview.input, text: "Changed"}},
      {input: {...preview.input, userInput: [{type: "text", text: "Different"}]}}])
      expect(() => decodeAgentPaperPrepareStatusResponse({schemaVersion: 1, intent: nativeIntent, status: {type: "committed", proof, result: {...preview, ...patch}}})).toThrow();
    expect(() => decodeAgentPaperPrepareStatusResponse({schemaVersion: 1, intent: nativeIntent, status: {type: "unconfirmed", detail: {...diagnostic, operationId: other}}})).toThrow();
  });
});
