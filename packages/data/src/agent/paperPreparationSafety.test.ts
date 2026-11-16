import {expect, it, vi} from "vitest";
import {createAgentPaperPrepareProvenGateway, createAgentPaperPrepareStatusGateway} from "./paperPreparationStatus";
import {createAgentPaperSubmissionGateway} from "./paperSubmission";
import {createAgentPaperStartStatusGateway} from "./paperStartStatus";

const conversationId = "a1111111-1111-4111-8111-111111111111";
const requestId = "b1111111-1111-4111-8111-111111111111";
const turnId = "c1111111-1111-4111-8111-111111111111";
const contextSnapshotId = "d1111111-1111-4111-8111-111111111111";
const epoch = "e1111111-1111-4111-8111-111111111111";
const foreign = "f1111111-1111-4111-8111-111111111111";
const request = {conversationId, requestId, paperId: "paper", paperContextSnapshotId: "snapshot",
  expectedContextHash: "a".repeat(64), text: "Original guarded request"};
const preview = {schemaVersion: 1 as const, conversationId, requestId, paperId: request.paperId,
  paperContextSnapshotId: request.paperContextSnapshotId, turnId, contextSnapshotId,
  input: {text: request.text, model: {providerId: "fixture", modelId: "fixture", revision: null}, reasoningEffort: null, context: []}};
const proof = {schemaVersion: 1, operationId: requestId, conversationId, family: "agent.paper.submission.prepare",
  epoch, sqlFence: "18446744073709551615", replayed: true, result: null};
const committed = () => ({schemaVersion: 1, intent: {...request, model: null}, status: {type: "committed", proof, result: preview}});

it("preserves a lost preparation acknowledgment and inspects only its original guarded request", async () => {
  const cause = Object.freeze({code: "data_operation_outcome_unknown", operationId: requestId});
  const invoke = vi.fn(async (command: string) => {
    if (command === "agent_prepare_paper_submission_proven") throw cause;
    return committed();
  });
  await expect(createAgentPaperPrepareProvenGateway(invoke).prepare(request, {expectedEpoch: epoch})).rejects.toBe(cause);
  const status = await createAgentPaperPrepareStatusGateway(invoke).read(request, {expectedEpoch: epoch});
  expect(status.status).toMatchObject({type: "committed", proof: {epoch, sqlFence: proof.sqlFence}, result: preview});
  expect(invoke.mock.calls.map(([command]) => command)).toEqual([
    "agent_prepare_paper_submission_proven", "agent_read_paper_submission_prepare_status",
  ]);
});

it("keeps the frozen preparation identity when the caller edits a newer draft during inspection", async () => {
  const draft = {...request};
  let release!: (value: unknown) => void;
  const invoke = vi.fn((_command: string, _args: Record<string, unknown>) => new Promise(resolve => {release = resolve;}));
  const pending = createAgentPaperPrepareStatusGateway(invoke).read(draft, {expectedEpoch: epoch});
  draft.text = "A newer local draft";
  release(committed());
  const status = await pending;
  expect(status.intent.text).toBe(request.text);
  expect(draft.text).toBe("A newer local draft");
  expect(invoke).toHaveBeenCalledExactlyOnceWith("agent_read_paper_submission_prepare_status", {
    request: {...request, model: null}, expectedEpoch: epoch,
  });
});

it("rejects a recovered preparation from another epoch before exposing its receipt", async () => {
  const invoke = vi.fn(async () => ({...committed(), status: {...committed().status, proof: {...proof, epoch: foreign}}}));
  await expect(createAgentPaperPrepareStatusGateway(invoke).read(request, {expectedEpoch: epoch})).rejects.toThrow("Mismatched paper preparation intent");
  expect(invoke).toHaveBeenCalledOnce();
});

it("retains a lost start acknowledgment and exposes read-only inspection of the frozen admission", async () => {
  const start = {conversationId, requestId, paperId: request.paperId,
    paperContextSnapshotId: request.paperContextSnapshotId, contextSnapshotId,
    model: preview.input.model, mode: "chatGptDefault" as const};
  const cause = Object.freeze({code: "agent_start_outcome_unknown", requestId});
  const detail = {operationId: requestId, epoch, sqlFence: null, phase: "paper-start-status",
    sqliteCode: null, sqliteExtendedCode: null, safeCause: "paper_start_worker_unconfirmed"};
  const invoke = vi.fn(async (command: string) => {
    if (command === "agent_start_paper_submission") throw cause;
    return {schemaVersion: 1, intent: start, status: {type: "unconfirmed", detail}};
  });
  await expect(createAgentPaperSubmissionGateway(invoke).start(preview, start.mode, {expectedEpoch: epoch})).rejects.toBe(cause);
  expect((await createAgentPaperStartStatusGateway(invoke).read(start, {expectedEpoch: epoch})).status).toEqual({type: "unconfirmed", detail});
  expect(invoke.mock.calls.map(([command]) => command)).toEqual([
    "agent_start_paper_submission", "agent_read_paper_start_status",
  ]);
});
