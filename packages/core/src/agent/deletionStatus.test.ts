import { expect, it } from "vitest";
import { decodeAgentDeletionProof, decodeAgentDeletionStatus } from "./deletionStatus";
import { decodeAgentDeletionWriteOptions } from "./deletion";
const operationId = "00000000-0000-4000-8000-000000000001", conversationId = "00000000-0000-4000-8000-000000000002";
const epoch = "00000000-0000-4000-8000-000000000003";
const proof = {schemaVersion: 1, operationId, conversationId, family: "agent.conversation.delete", epoch,
  sqlFence: "18446744073709551615", replayed: true, result: null};
it("keeps deletion operation and conversation identities separate and decodes all readonly states", () => {
  expect(decodeAgentDeletionProof(proof)).toEqual(proof);
  for (const status of [{type: "committed", proof}, {type: "noSqlReceipt", epoch, sqlFence: "0", closed: false},
    {type: "unconfirmed", epoch, sqlFence: "3", blocked: true, closed: false, reason: "commit_unknown"}]) {
    const response = {schemaVersion: 1, operationId, conversationId, status};
    expect(decodeAgentDeletionStatus(response)).toEqual(response);
  }
});
it("requires the correct family and both proof identities without coercing native evidence", () => {
  for (const patch of [{family: "agent.conversation.fork"}, {epoch: "invalid"}, {result: {}}, {replayed: 1},
    {sqlFence: 1}, {sqlFence: "18446744073709551616"}, {sqlFence: "01"}]) {
    expect(() => decodeAgentDeletionProof({...proof, ...patch})).toThrow();
  }
  for (const patch of [{operationId: epoch}, {conversationId: epoch}]) {
    expect(() => decodeAgentDeletionStatus({schemaVersion: 1, operationId, conversationId,
      status: {type: "committed", proof: {...proof, ...patch}}})).toThrow();
  }
  expect(() => decodeAgentDeletionStatus({schemaVersion: 1, operationId, conversationId,
    status: {type: "noSqlReceipt", epoch, sqlFence: "0", closed: false, proof}})).toThrow();
});
it("validates the transport epoch separately and accepts native UUID spellings", () => {
  expect(decodeAgentDeletionWriteOptions({expectedEpoch: `{${epoch}}`})).toEqual({expectedEpoch: epoch});
  for (const value of [{}, {expectedEpoch: ""}, {expectedEpoch: "00000000-0000-0000-0000-000000000000"},
    {expectedEpoch: epoch, force: true}]) expect(() => decodeAgentDeletionWriteOptions(value)).toThrow();
});
