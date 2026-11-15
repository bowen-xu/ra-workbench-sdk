import { expect, it } from "vitest";
import { decodeAgentRenameProof, decodeAgentRenameRequest, decodeAgentRenameStatus } from "./catalogRename";

const operationId = "00000000-0000-0000-0000-000000000001", conversationId = "00000000-0000-0000-0000-000000000002";
const epoch = "00000000-0000-0000-0000-000000000003";
const proof = { schemaVersion: 1, operationId, conversationId, family: "agent.conversation.rename", epoch,
  sqlFence: "9007199254740993", replayed: true, result: null };
const request = { operationId, id: conversationId, expectedTitle: "旧名", title: " 新名 " };

it("keeps immutable text and matches native UUID identity spelling", () => {
  expect(decodeAgentRenameRequest(request)).toEqual(request);
  expect(decodeAgentRenameRequest({...request, operationId: `{${operationId}}`, id: conversationId.replaceAll("-", "")})).toEqual(request);
  expect(decodeAgentRenameProof(proof)).toEqual(proof);
});
it("validates target title rules while preserving opaque legacy CAS text", () => {
  expect(decodeAgentRenameRequest({...request, expectedTitle: ""}).expectedTitle).toBe("");
  const legacy = "旧".repeat(2048) + "\0";
  expect(decodeAgentRenameRequest({...request, expectedTitle: legacy}).expectedTitle).toBe(legacy);
  expect(decodeAgentRenameRequest({...request, title: "界".repeat(180)}).title).toHaveLength(180);
  for (const patch of [{operationId: "00000000-0000-0000-0000-000000000000"}, {title: " "}, {title: "a\0b"},
    {title: "界".repeat(181)}, {expectedTitle: null}, {extra: true}]) {
    expect(() => decodeAgentRenameRequest({...request, ...patch})).toThrow();
  }
});
it("rejects another family, result shape, unsafe fence or malformed proof without treating it as a summary", () => {
  for (const patch of [{family: "agent.rollback_authority"}, {result: {}}, {replayed: 1}, {schemaVersion: 2},
    {sqlFence: 1}, {sqlFence: "01"}, {sqlFence: "18446744073709551616"}, {title: "not a view"}]) {
    expect(() => decodeAgentRenameProof({...proof, ...patch})).toThrow();
  }
  expect(decodeAgentRenameProof({...proof, sqlFence: "18446744073709551615"}).sqlFence).toBe("18446744073709551615");
  expect(decodeAgentRenameProof({...proof, sqlFence: "0"}).sqlFence).toBe("0");
});
it("preserves unconfirmed and missing-receipt states independently of commit evidence", () => {
  for (const status of [
    {type: "committed", proof},
    {type: "noSqlReceipt", epoch, sqlFence: "0", closed: true},
    {type: "unconfirmed", epoch, sqlFence: "2", blocked: true, closed: false, reason: "sql_transaction_open"},
  ]) {
    const response = {schemaVersion: 1, operationId, conversationId, status};
    expect(decodeAgentRenameStatus(response)).toEqual(response);
  }
});
it("rejects mismatched nested proofs and status fields from another variant", () => {
  const envelope = {schemaVersion: 1, operationId, conversationId};
  for (const status of [{type: "committed", proof: {...proof, operationId: epoch}},
    {type: "committed", proof, closed: false}, {type: "noSqlReceipt", epoch, sqlFence: "0", closed: false, blocked: false},
    {type: "unconfirmed", epoch, sqlFence: "0", closed: false, blocked: true, reason: "raw error\nbody"}]) {
    expect(() => decodeAgentRenameStatus({...envelope, status})).toThrow();
  }
});
