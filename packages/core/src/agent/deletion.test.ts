import {expect, it} from "vitest";
import {decodeAgentDeletionRequest} from "./deletion";

const request = {schemaVersion: 1, requestId: "11111111-1111-4111-8111-111111111111",
  conversationId: "22222222-2222-4222-8222-222222222222", binding: null,
  expectedTitle: "Synthetic conversation", expectedDurableCount: 3, force: false};

it("requires explicit global scope while preserving bound deletion requests", () => {
  expect(decodeAgentDeletionRequest(request)).toEqual(request);
  const binding = {kind: "manuscript", resourceId: "managed-directory"};
  expect(decodeAgentDeletionRequest({...request, binding}).binding).toEqual(binding);
  const {binding: _binding, ...missing} = request;
  expect(() => decodeAgentDeletionRequest(missing)).toThrow();
  for (const invalid of [{expectedTitle: ""}, {expectedDurableCount: -1}, {expectedDurableCount: 1.5}, {force: "true"}]) {
    expect(() => decodeAgentDeletionRequest({...request, ...invalid})).toThrow();
  }
});
