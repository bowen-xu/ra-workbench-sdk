import {expect, it} from "vitest";
import {decodeAgentStartResponse} from "./submission";

it("retains a process-local run identity while accepting older and replayed responses", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const response = {schemaVersion: 1, conversationId: id, requestId: id, turnId: id, alreadyStarted: false, outcome: null};
  expect(decodeAgentStartResponse(response)).toEqual(response);
  expect(decodeAgentStartResponse({...response, runId: id})).toEqual({...response, runId: id});
  expect(decodeAgentStartResponse({...response, alreadyStarted: true, outcome: "completed"})).toEqual({...response, alreadyStarted: true, outcome: "completed"});
  expect(decodeAgentStartResponse({...response, alreadyStarted: true, runId: id})).toEqual({...response, alreadyStarted: true, runId: id});
  for (const runId of [null, "", "00000000-0000-0000-0000-000000000000"]) {
    expect(() => decodeAgentStartResponse({...response, runId})).toThrow();
  }
});
