import { expect, it } from "vitest";
import { decodeAgentForkProof, decodeAgentForkStatus } from "./forkStatus";
const child = "00000000-0000-4000-8000-000000000001", epoch = "00000000-0000-4000-8000-000000000002";
const proof = { schemaVersion: 1, operationId: child, conversationId: child, family: "agent.conversation.fork", epoch,
  sqlFence: "18446744073709551615", replayed: true, result: null };
it("decodes the native unit proof and all readonly states without coercing SQL fences", () => {
  expect(decodeAgentForkProof(proof)).toEqual(proof);
  for (const status of [{ type: "committed", proof }, { type: "noSqlReceipt", epoch, sqlFence: "0", closed: false },
    { type: "unconfirmed", epoch, sqlFence: "3", blocked: true, closed: false, reason: "commit_unknown" }]) {
    const response = { schemaVersion: 1, operationId: child, conversationId: child, status };
    expect(decodeAgentForkStatus(response)).toEqual(response);
  }
});
it("rejects foreign families, mismatched child identity and malformed native evidence", () => {
  for (const patch of [{ family: "agent.conversation.rename" }, { operationId: epoch }, { conversationId: epoch },
    { sqlFence: 3 }, { sqlFence: "18446744073709551616" }, { result: {} }, { replayed: 1 }]) {
    expect(() => decodeAgentForkProof({ ...proof, ...patch })).toThrow();
  }
  expect(() => decodeAgentForkStatus({ schemaVersion: 1, operationId: epoch, conversationId: epoch, status: { type: "committed", proof } })).toThrow();
  expect(() => decodeAgentForkStatus({ schemaVersion: 1, operationId: child, conversationId: child,
    status: { type: "noSqlReceipt", epoch, sqlFence: "0", closed: false, proof } })).toThrow();
});
