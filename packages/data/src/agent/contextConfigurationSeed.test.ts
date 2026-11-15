import { expect, it, vi } from "vitest";
import { createAgentContextConfigurationSeedGateway } from "./contextConfigurationSeed";

const operationId = "11111111-1111-4111-8111-111111111111";
const conversationId = "22222222-2222-4222-8222-222222222222";
const expectedEpoch = "33333333-3333-4333-8333-333333333333";
const intent = { operationId, conversationId, expectedEpoch };
const proof = { schemaVersion: 1, operationId, conversationId, epoch: expectedEpoch,
  family: "agent.context.configuration.seed", sqlFence: "9007199254740993", replayed: false, result: null };

it("sends the original seed intent and rejects receipts for another operation, conversation, epoch or family", async () => {
  const invoke = vi.fn(async (): Promise<unknown> => proof);
  const gateway = createAgentContextConfigurationSeedGateway(invoke);
  expect(await gateway.seed(intent)).toEqual(proof);
  expect(invoke).toHaveBeenCalledExactlyOnceWith("agent_seed_context_configuration_proven", { request: intent });
  for (const changed of [{ operationId: conversationId }, { conversationId: operationId }, { epoch: operationId },
    { family: "agent.context.configuration.save" }, { result: {} }]) {
    invoke.mockResolvedValueOnce({ ...proof, ...changed });
    await expect(gateway.seed(intent)).rejects.toThrow();
  }
});

it("preserves an unconfirmed status and checks the exact seed receipt", async () => {
  const invoke = vi.fn(async (): Promise<unknown> => ({ type: "noSqlReceipt", epoch: expectedEpoch, sqlFence: "0", closed: false }));
  const gateway = createAgentContextConfigurationSeedGateway(invoke);
  expect((await gateway.status(intent)).type).toBe("noSqlReceipt");
  expect(invoke).toHaveBeenCalledWith("agent_read_context_configuration_seed_status", { request: intent });
  invoke.mockResolvedValueOnce({ type: "unconfirmed", epoch: expectedEpoch, sqlFence: "0", closed: false, blocked: true, reason: "owner_blocked_receipt_unconfirmed" });
  expect((await gateway.status(intent)).type).toBe("unconfirmed");
  invoke.mockResolvedValueOnce({ type: "committed", proof: { ...proof, replayed: true } });
  expect((await gateway.status(intent)).type).toBe("committed");
  invoke.mockResolvedValueOnce({ type: "committed", proof: { ...proof, operationId: conversationId } });
  await expect(gateway.status(intent)).rejects.toThrow("CONTEXT_CONFIGURATION_SEED_PROOF_MISMATCH");
  invoke.mockResolvedValueOnce({ type: "noSqlReceipt", epoch: operationId, sqlFence: "0", closed: false });
  await expect(gateway.status(intent)).rejects.toThrow("CONTEXT_CONFIGURATION_SEED_EPOCH_MISMATCH");
});

it("rejects malformed intents before invoking and does not accept unknown status fields", async () => {
  const invoke = vi.fn(async (): Promise<unknown> => ({ type: "committed", proof: { ...proof, extra: true } }));
  const gateway = createAgentContextConfigurationSeedGateway(invoke);
  await expect(gateway.seed({ ...intent, expectedEpoch: "bad" })).rejects.toThrow();
  expect(invoke).not.toHaveBeenCalled();
  await expect(gateway.status(intent)).rejects.toThrow();
});
