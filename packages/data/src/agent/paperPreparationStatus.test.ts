import {expect, it, vi} from "vitest";
import {createAgentPaperPrepareProvenGateway, createAgentPaperPrepareStatusGateway} from "./paperPreparationStatus";

const request = {conversationId: "a1111111-1111-4111-8111-111111111111", requestId: "b1111111-1111-4111-8111-111111111111",
  paperId: "paper", paperContextSnapshotId: "snapshot", expectedContextHash: "a".repeat(64), text: "Explain"};
const detail = {operationId: request.requestId, epoch: null, sqlFence: null, phase: "paper-prepare-status", sqliteCode: null, sqliteExtendedCode: null, safeCause: "paper_prepare_worker_unconfirmed"};
it("checks the full returned intent before exposing the native status", async () => {
  const invoke = vi.fn().mockResolvedValue({schemaVersion: 1, intent: {...request, userInput: [], model: null, retrieval: null, sessionConfig: null, turnConfig: null}, status: {type: "unconfirmed", detail}});
  const gateway = createAgentPaperPrepareStatusGateway(invoke);
  expect((await gateway.read(request)).status.type).toBe("unconfirmed");
  expect(invoke).toHaveBeenCalledWith("agent_read_paper_submission_prepare_status", {request: {...request, model: null}});
  invoke.mockResolvedValueOnce({schemaVersion: 1, intent: {...request, text: "Changed", model: null}, status: {type: "unconfirmed", detail}});
  await expect(gateway.read(request)).rejects.toThrow("Mismatched paper preparation intent");
});
it("returns only the proof and frozen result from the original preparation request", async () => {
  const epoch = "e1111111-1111-4111-8111-111111111111", turnId = "c1111111-1111-4111-8111-111111111111";
  const result = {schemaVersion: 1, conversationId: request.conversationId, requestId: request.requestId, paperId: request.paperId,
    paperContextSnapshotId: request.paperContextSnapshotId, turnId, contextSnapshotId: "d1111111-1111-4111-8111-111111111111",
    input: {text: request.text, model: {providerId: "deepseek", modelId: "fixture", revision: null}, reasoningEffort: null, context: []}};
  const proof = {schemaVersion: 1, operationId: request.requestId, conversationId: request.conversationId,
    family: "agent.paper.submission.prepare", epoch, sqlFence: "12", replayed: false, result: null};
  const invoke = vi.fn().mockResolvedValue({schemaVersion: 1, intent: {...request, model: null}, status: {type: "committed", proof, result}});
  const gateway = createAgentPaperPrepareProvenGateway(invoke);
  expect(await gateway.prepare(request)).toMatchObject({type: "committed", proof, result});
  expect(invoke).toHaveBeenCalledWith("agent_prepare_paper_submission_proven", {request: {...request, model: null}});
  expect(await gateway.prepare(request, {expectedEpoch: epoch})).toMatchObject({proof});
  expect(invoke).toHaveBeenLastCalledWith("agent_prepare_paper_submission_proven", {request: {...request, model: null}, expectedEpoch: epoch});
  await expect(gateway.prepare(request, {expectedEpoch: turnId})).rejects.toThrow("Mismatched paper preparation proof");
  const status = createAgentPaperPrepareStatusGateway(invoke);
  expect((await status.read(request, {expectedEpoch: epoch})).status.type).toBe("committed");
  await expect(status.read(request, {expectedEpoch: turnId})).rejects.toThrow("Mismatched paper preparation intent");
  invoke.mockResolvedValueOnce({schemaVersion: 1, intent: {...request, model: null}, status: {type: "unconfirmed", detail}});
  await expect(gateway.prepare(request)).rejects.toThrow("Mismatched paper preparation proof");
  invoke.mockResolvedValueOnce({schemaVersion: 1, intent: {...request, model: null}, status: {type: "committed", proof: {...proof, operationId: turnId}, result}});
  await expect(gateway.prepare(request)).rejects.toThrow();
});
