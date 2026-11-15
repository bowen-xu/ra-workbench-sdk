import {expect, it, vi} from "vitest";
import {createAgentContextPrepareProvenGateway, createAgentContextPrepareStatusGateway} from "./contextPreparationStatus";

const id = (n: number) => `abcdef00-1234-4678-abcd-${String(n).padStart(12, "0")}`;
const request = {conversationId: id(1), requestId: id(2), text: "Question", resources: []};
const intent = {...request, userInput: [], retrieval: null, model: null, queue: null};
const detail = {operationId: id(2), epoch: id(3), sqlFence: "0", phase: "context-prepare-status", sqliteCode: null, sqliteExtendedCode: null, safeCause: "context_prepare_worker_unconfirmed"};
const result = {schemaVersion: 1, conversationId: id(1), requestId: id(2), turnId: id(4), contextSnapshotId: id(5), input: {text: "Question", model: {providerId: "fixture", modelId: "model", revision: null}, reasoningEffort: null, context: []}};
const proof = {schemaVersion: 1, operationId: id(2), conversationId: id(1), family: "agent.context.submission.prepare", epoch: id(3), sqlFence: "12", replayed: false, result: null};

it("checks the complete intent and environment before exposing status", async () => {
  const invoke = vi.fn().mockResolvedValue({schemaVersion: 1, intent, expectedEpoch: id(3), status: {type: "unconfirmed", detail}});
  const gateway = createAgentContextPrepareStatusGateway(invoke);
  expect((await gateway.read(request, {expectedEpoch: id(3)})).status.type).toBe("unconfirmed");
  expect(invoke).toHaveBeenCalledWith("agent_read_context_submission_prepare_status", {request: intent, expectedEpoch: id(3)});
  invoke.mockResolvedValueOnce({schemaVersion: 1, intent: {...intent, text: "Changed"}, expectedEpoch: id(3), status: {type: "unconfirmed", detail}});
  await expect(gateway.read(request, {expectedEpoch: id(3)})).rejects.toThrow();
  await expect(gateway.read(request, {expectedEpoch: id(9)})).rejects.toThrow();
});

it("returns only a matching committed proof and refuses unconfirmed status", async () => {
  const invoke = vi.fn().mockResolvedValue({schemaVersion: 1, intent, expectedEpoch: id(3), status: {type: "committed", proof, result}});
  const gateway = createAgentContextPrepareProvenGateway(invoke);
  expect(await gateway.prepare(request, {expectedEpoch: id(3)})).toMatchObject({type: "committed", proof, result});
  expect(invoke).toHaveBeenCalledWith("agent_prepare_context_submission_proven", {request: intent, expectedEpoch: id(3)});
  invoke.mockResolvedValueOnce({schemaVersion: 1, intent, expectedEpoch: id(3), status: {type: "unconfirmed", detail}});
  await expect(gateway.prepare(request, {expectedEpoch: id(3)})).rejects.toThrow("Context preparation proof unavailable");
  invoke.mockResolvedValueOnce({schemaVersion: 1, intent, expectedEpoch: id(3), status: {type: "committed", proof: {...proof, operationId: id(9)}, result}});
  await expect(gateway.prepare(request, {expectedEpoch: id(3)})).rejects.toThrow();
});
