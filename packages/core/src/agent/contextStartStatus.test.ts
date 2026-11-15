import {describe, expect, it} from "vitest";
import {decodeAgentContextStartStatusResponse} from "./contextStartStatus";

describe("context start status", () => {
  it("retains an original request's queue admission diagnostic", () => {
    const requestId = "00000000-0000-4000-8000-000000000002";
    const epoch = "00000000-0000-4000-8000-000000000005";
    const response = decodeAgentContextStartStatusResponse({
      schemaVersion: 1, expectedEpoch: epoch,
      intent: {conversationId: "00000000-0000-4000-8000-000000000001", requestId,
        contextSnapshotId: "00000000-0000-4000-8000-000000000003",
        queue: {inputId: "00000000-0000-4000-8000-000000000004", expectedRevision: 9}, resumeQueue: true},
      status: {type: "unconfirmed", detail: {operationId: requestId, epoch, sqlFence: "12",
        phase: "context-queue-admission", sqliteCode: null, sqliteExtendedCode: null,
        safeCause: "operation_id_content_changed"}},
    });
    expect(response.status).toMatchObject({type: "unconfirmed", detail: {operationId: requestId, safeCause: "operation_id_content_changed"}});
  });
  it("accepts legacy settlement only for a terminal queued turn without a run identity", () => {
    const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
    const value = {schemaVersion: 1, expectedEpoch: id(5), intent: {conversationId: id(1), requestId: id(2),
      contextSnapshotId: id(3), queue: {inputId: id(4), expectedRevision: 9}, resumeQueue: false},
      status: {type: "legacyStartedSettled", result: {schemaVersion: 1, conversationId: id(1), requestId: id(2),
        turnId: id(6), alreadyStarted: true, outcome: "completed"}}};
    expect(decodeAgentContextStartStatusResponse(value).status.type).toBe("legacyStartedSettled");
    expect(() => decodeAgentContextStartStatusResponse({...value, intent: {...value.intent, queue: null}})).toThrow();
    expect(() => decodeAgentContextStartStatusResponse({...value, status: {...value.status, result: {...value.status.result, outcome: null}}})).toThrow();
    expect(() => decodeAgentContextStartStatusResponse({...value, status: {...value.status, result: {...value.status.result, runId: id(7)}}})).toThrow();
  });
  it("accepts legacy observation only with a queued request and an original run identity", () => {
    const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
    const value = {schemaVersion: 1, expectedEpoch: id(5), intent: {conversationId: id(1), requestId: id(2),
      contextSnapshotId: id(3), queue: {inputId: id(4), expectedRevision: 9}, resumeQueue: false},
      status: {type: "legacyStartedObserved", result: {schemaVersion: 1, conversationId: id(1), requestId: id(2),
        turnId: id(6), runId: id(7), alreadyStarted: true, outcome: null}}};
    expect(decodeAgentContextStartStatusResponse(value).status.type).toBe("legacyStartedObserved");
    expect(() => decodeAgentContextStartStatusResponse({...value, intent: {...value.intent, queue: null}})).toThrow();
    const {runId: _runId, ...withoutRun} = value.status.result;
    expect(() => decodeAgentContextStartStatusResponse({...value, status: {...value.status, result: withoutRun}})).toThrow();
  });
});
