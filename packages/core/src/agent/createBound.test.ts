import { expect, it } from "vitest";
import { decodeAgentCreateBoundProof, decodeAgentCreateBoundRequest, decodeAgentCreateBoundStatus } from "./createBound";
import { agentSqlFence } from "./catalogRename";

const operationId = "00000000-0000-0000-0000-000000000001", conversationId = "00000000-0000-0000-0000-000000000002";
const epoch = "00000000-0000-0000-0000-000000000003";
const request = {operationId, id: conversationId, binding: {kind: "readingNote", resourceId: " source-block "}};
const proof = {schemaVersion: 1, operationId, conversationId, family: "agent.conversation.create_bound", epoch,
  sqlFence: "9007199254740993", replayed: false, result: null};
const envelope = {schemaVersion: 1, operationId, conversationId};

it("preserves binding intent and accepts the same UUID spellings as native serde", () => {
  expect(decodeAgentCreateBoundRequest(request)).toEqual(request);
  for (const operation of [operationId, `{${operationId}}`, operationId.replaceAll("-", ""), `urn:uuid:${operationId}`])
    expect(decodeAgentCreateBoundRequest({...request, operationId: operation})).toEqual(request);
  expect(decodeAgentCreateBoundProof(proof)).toEqual(proof);
  expect(agentSqlFence("18446744073709551615")).toBe("18446744073709551615");
});
it("requires an independent operation and a closed valid binding without adding target heuristics", () => {
  for (const patch of [{operationId: undefined}, {operationId: "00000000-0000-0000-0000-000000000000"},
    {id: "invalid"}, {binding: null}, {binding: {kind: "other", resourceId: "one"}},
    {binding: {kind: "note", resourceId: ""}}, {binding: {kind: "note", resourceId: "a\0b"}}, {extra: true}])
    expect(() => decodeAgentCreateBoundRequest({...request, ...patch})).toThrow();
});
it("accepts only creation evidence, retaining exact decimal fences", () => {
  for (const patch of [{family: "agent.conversation.rename"}, {result: {}}, {schemaVersion: 2}, {sqlFence: 0},
    {sqlFence: "00"}, {sqlFence: "18446744073709551616"}, {replayed: 1}, {conversation: {}}])
    expect(() => decodeAgentCreateBoundProof({...proof, ...patch})).toThrow();
  expect(decodeAgentCreateBoundProof({...proof, sqlFence: "0"}).sqlFence).toBe("0");
});
it("keeps absent and unconfirmed receipts distinct from committed proof", () => {
  for (const status of [{type: "committed", proof}, {type: "noSqlReceipt", epoch, sqlFence: "0", closed: true},
    {type: "unconfirmed", epoch, sqlFence: "2", blocked: true, closed: false, reason: "sql_transaction_open"}])
    expect(decodeAgentCreateBoundStatus({...envelope, status})).toEqual({...envelope, status});
});
it("rejects a foreign nested proof and variant fields without turning absence into permission", () => {
  for (const status of [{type: "committed", proof: {...proof, operationId: epoch}},
    {type: "committed", proof, closed: false}, {type: "noSqlReceipt", epoch, sqlFence: "0", closed: false, blocked: false},
    {type: "unconfirmed", epoch, sqlFence: "0", closed: false, blocked: true, reason: "unsafe\nbody"}])
    expect(() => decodeAgentCreateBoundStatus({...envelope, status})).toThrow();
});
