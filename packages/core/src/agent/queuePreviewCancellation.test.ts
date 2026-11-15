import { expect, it } from "vitest";
import { decodeAgentWritingQueueCancelRequest, decodeAgentWritingQueueCancelProof,
  decodeAgentWritingQueueCancelStatusResponse } from "./queuePreviewCancellation";

const id = (n: number) => `abcdef00-1234-5678-abcd-${String(n).padStart(12, "0")}`;
const intent = {conversationId: id(1), manuscriptId: id(2), requestId: id(3), expectedRevision: 8, inputId: id(4), previewRequestId: id(5)};
const queue = {schemaVersion: 1, conversationId: id(1), manuscriptId: id(2), revision: 9,
  paused: true, preparingInputId: null, inputs: [{inputId: id(4), text: "original input"}]};
const proof = {schemaVersion: 1, operationId: id(3), conversationId: id(1), family: "agent.queue.preview.cancel",
  epoch: id(6), sqlFence: "18446744073709551615", replayed: true, result: null};
const detail = {operationId: id(3), epoch: id(6), sqlFence: "9", phase: "queue-cancel-status",
  sqliteCode: null, sqliteExtendedCode: null, safeCause: "legacy_cancel_receipt_without_sql_proof"};

it("keeps the complete original cancellation and canonicalizes only UUID spellings", () => {
  const input = {...intent, conversationId: id(1).toUpperCase(), requestId: `urn:uuid:${id(3)}`};
  const frozen = decodeAgentWritingQueueCancelRequest(input);
  input.expectedRevision = 99;
  expect(frozen).toEqual(intent);
  for (const field of Object.keys(intent)) {
    const incomplete = {...intent} as Record<string, unknown>; delete incomplete[field];
    expect(() => decodeAgentWritingQueueCancelRequest(incomplete)).toThrow();
  }
  for (const patch of [{expectedRevision: Number.MAX_SAFE_INTEGER}, {expectedRevision: -1}, {expectedRevision: 1.5},
    {inputId: "00000000-0000-0000-0000-000000000000"}, {previewRequestId: null}, {execute: true}])
    expect(() => decodeAgentWritingQueueCancelRequest({...intent, ...patch})).toThrow();
});

it("distinguishes committed evidence, missing evidence and legacy or blocked uncertainty", () => {
  for (const status of [{type: "committed", proof, queue}, {type: "notFound"}, {type: "unconfirmed", detail}]) {
    const value = {schemaVersion: 1, intent, status};
    expect(decodeAgentWritingQueueCancelStatusResponse(value)).toEqual(value);
  }
  for (const status of [{type: "notFound", queue}, {type: "committed", proof},
    {type: "unconfirmed", detail: {...detail, operationId: id(99)}},
    {type: "unconfirmed", detail: {...detail, safeCause: "private provider body\n"}},
    {type: "unconfirmed", detail: {...detail, sqlFence: 9}},
    {type: "unconfirmed", detail: {...detail, message: "private request"}}])
    expect(() => decodeAgentWritingQueueCancelStatusResponse({schemaVersion: 1, intent, status})).toThrow();
});

it("binds historical success to the original operation, queue scope and release result", () => {
  const value = {schemaVersion: 1, intent, status: {type: "committed", proof, queue}};
  for (const patch of [{operationId: id(99)}, {conversationId: id(99)}])
    expect(() => decodeAgentWritingQueueCancelStatusResponse({...value, status: {...value.status, proof: {...proof, ...patch}}})).toThrow();
  for (const patch of [{family: "agent.conversation.rename"},
    {sqlFence: 9}, {sqlFence: "18446744073709551616"}, {sqlFence: "01"}, {result: {}}, {replayed: 1}]) {
    expect(() => decodeAgentWritingQueueCancelProof({...proof, ...patch})).toThrowError();
    expect(() => decodeAgentWritingQueueCancelStatusResponse({...value, status: {...value.status, proof: {...proof, ...patch}}})).toThrow();
  }
  for (const patch of [{revision: 10}, {paused: false}, {preparingInputId: id(4)}, {inputs: []}, {manuscriptId: id(99)}])
    expect(() => decodeAgentWritingQueueCancelStatusResponse({...value, status: {...value.status, queue: {...queue, ...patch}}})).toThrow();
});
