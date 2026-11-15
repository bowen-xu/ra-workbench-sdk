import {expect, it} from "vitest";
import golden from "../../../../tests/fixtures/agent-queue-edit-status-native-v1.json";
import {agentQueueEditIntentFromRequest} from "./queueEditIntent";
import {decodeAgentQueueEditStatusResponse} from "./queueEditStatus";
import {decodeAgentQueueStorageFailure} from "./queueEditFailure";

const scopes = golden.scopes.map(sample => ({kind: sample.committed.intent.scope.kind, ...sample}));
const foreign = "00000000-1111-4222-8333-444444444444";

it("contains the five actual Native host entry points, not locally constructed status DTOs", () => {
  expect(golden.schemaVersion).toBe(1);
  expect(scopes.map(sample => sample.kind)).toEqual(["manuscript", "paper", "note", "readingNote", "context"]);
});

it.each(scopes)("$kind decodes actual Native committed/notFound serde output and original W0", sample => {
  const {request, committed, notFound} = sample;
  expect(request.expectedRevision).toBe(0);
  expect(agentQueueEditIntentFromRequest(request)).toEqual(committed.intent);
  expect(decodeAgentQueueEditStatusResponse(committed, request)).toEqual(committed);
  expect(decodeAgentQueueEditStatusResponse(notFound, request)).toEqual(notFound);
  expect(committed.status.queue.revision).toBe(1);
  expect(committed.status.proof).toMatchObject({family: "agent.input_queue.edit", sqlFence: "0", replayed: true, result: null});
});

it.each(scopes)("$kind retains the real changed-revision failure and its safe full identity", sample => {
  const request = {...sample.request, expectedRevision: sample.request.expectedRevision + 1};
  expect(decodeAgentQueueStorageFailure(sample.storageFailure, request)).toEqual({
    code: "QUEUE_STORAGE_FAILURE", conversationId: request.conversationId, requestId: request.requestId,
    operationId: request.requestId, scope: sample.committed.intent.scope,
    reason: {code: "DATA_SQL_OPERATION_CONFLICT", diagnostic: sample.storageFailure.reason.reason},
  });
  expect(() => decodeAgentQueueEditStatusResponse(sample.storageFailure, request)).toThrow();
  expect(() => decodeAgentQueueEditStatusResponse(sample.committed, request)).toThrow();
  expect(decodeAgentQueueStorageFailure({...sample.storageFailure, conversationId: foreign}, request)).toBeUndefined();
  expect(decodeAgentQueueStorageFailure({...sample.storageFailure, requestId: foreign}, request)).toBeUndefined();
  expect(decodeAgentQueueStorageFailure({...sample.storageFailure, scope: {kind: "paper", paperId: "foreign"}}, request)).toBeUndefined();
});

it.each(scopes)("$kind does not copy unknown fields from a real Native failure", sample => {
  const value = {...sample.storageFailure, privateBody: "private request", reason: {...sample.storageFailure.reason,
    reason: {...sample.storageFailure.reason.reason, sql: "select private_body", authorization: "Bearer private-token"}}};
  const decoded = decodeAgentQueueStorageFailure(value, {...sample.request, expectedRevision: 1});
  expect(decoded?.reason.diagnostic).toEqual(sample.storageFailure.reason.reason);
  expect(JSON.stringify(decoded)).not.toMatch(/private request|private_body|private-token|authorization/u);
});
