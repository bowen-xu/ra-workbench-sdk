import {expect, it, vi} from "vitest";
import {createAgentPaperStartStatusGateway} from "./paperStartStatus";
const id = (n: number) => `abcdef00-1234-5678-abcd-${String(n).padStart(12,"0")}`;
const request = {conversationId: id(1), requestId: id(2), paperId: "paper", paperContextSnapshotId: "snapshot", contextSnapshotId: id(3),
  model: {providerId: "deepseek", modelId: "fixture", revision: null}, mode: "chatGptDefault" as const};
const detail = {operationId: id(2), epoch: null, sqlFence: null, phase: "paper-start-status", sqliteCode: null, sqliteExtendedCode: null, safeCause: "paper_start_worker_unconfirmed"};
it("sends a frozen start request and checks the echoed complete identity", async () => {
  const invoke = vi.fn(async () => ({schemaVersion: 1, intent: structuredClone(request), status: {type: "unconfirmed", detail}}));
  const response = await createAgentPaperStartStatusGateway(invoke).read(request);
  expect(response.status.type).toBe("unconfirmed"); expect(invoke).toHaveBeenCalledExactlyOnceWith("agent_read_paper_start_status", {request});
  const wrong = vi.fn(async () => ({schemaVersion: 1, intent: {...request, paperId: "other"}, status: {type: "unconfirmed", detail}}));
  await expect(createAgentPaperStartStatusGateway(wrong).read(request)).rejects.toThrow("Mismatched paper start intent");
});
it("forwards the frozen environment and rejects an observation from another environment", async () => {
  const epoch = id(4), invoke = vi.fn(async () => ({schemaVersion: 1, intent: request, status: {type: "unconfirmed", detail: {...detail, epoch}}}));
  const gateway = createAgentPaperStartStatusGateway(invoke);
  await gateway.read(request, {expectedEpoch: epoch});
  expect(invoke).toHaveBeenCalledWith("agent_read_paper_start_status", {request, expectedEpoch: epoch});
  await expect(gateway.read(request, {expectedEpoch: id(5)})).rejects.toThrow("Mismatched paper start intent");
});
