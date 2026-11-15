import { expect, it, vi } from "vitest";
import { createAgentArchiveGateway } from "../../packages/data/src/agent/index";
import { AGENT_ARCHIVE_FAMILY, decodeAgentArchiveRequest, decodeAgentArchiveStatus, type AgentArchiveRequest } from "../../packages/core/src/agent/index";

const conversationId = "11111111-1111-4111-8111-111111111111";
const operationId = "22222222-2222-4222-8222-222222222222";
const epoch = "33333333-3333-4333-8333-333333333333";
const request: AgentArchiveRequest = { operationId, id: conversationId, archived: true, expectedWatermark: 14 };
const proof = { schemaVersion: 1, operationId, conversationId, family: AGENT_ARCHIVE_FAMILY, epoch, sqlFence: "17", replayed: false, result: null };

it.each([true, false])("sends frozen intent and returns historical proof (archive=%s)", async archived => {
  const intent = { ...request, archived, expectedWatermark: archived ? 14 : null };
  const invoke = vi.fn().mockResolvedValue(proof), gateway = createAgentArchiveGateway(invoke);
  expect(await gateway.setArchived(intent)).toEqual(proof);
  expect(invoke).toHaveBeenCalledExactlyOnceWith("agent_set_conversation_archived", { request: intent });
});
it("inspects only the exact operation without reading current metadata or retrying", async () => {
  const status = { schemaVersion: 1, operationId, conversationId, status: { type: "committed", proof: { ...proof, replayed: true } } };
  const invoke = vi.fn().mockResolvedValue(status), gateway = createAgentArchiveGateway(invoke);
  expect(await gateway.archiveStatus(request)).toEqual(status);
  expect(invoke).toHaveBeenCalledExactlyOnceWith("agent_read_conversation_archive_status", { request });
});
it("canonicalizes UUID spelling while preserving the original decision watermark", async () => {
  const intent = { ...request, operationId: "abcdefab-1111-4111-8111-111111111111", id: "abcdefab-2222-4222-8222-222222222222" };
  const invoke = vi.fn().mockResolvedValue({ ...proof, operationId: intent.operationId, conversationId: intent.id });
  await createAgentArchiveGateway(invoke).setArchived({ ...intent, id: intent.id.toUpperCase(), operationId: intent.operationId.toUpperCase() });
  expect(invoke).toHaveBeenCalledExactlyOnceWith("agent_set_conversation_archived", { request: intent });
});
it.each([
  { id: "bad" }, { operationId: "00000000-0000-0000-0000-000000000000" },
  { expectedWatermark: null }, { expectedWatermark: -1 }, { expectedWatermark: 0.5 },
  { expectedWatermark: Number.MAX_SAFE_INTEGER + 1 }, { archived: false, expectedWatermark: 14 },
])("rejects invalid original archive intent before I/O: %j", async patch => {
  const invoke = vi.fn(), gateway = createAgentArchiveGateway(invoke);
  await expect(gateway.setArchived({ ...request, ...patch })).rejects.toThrow();
  await expect(gateway.archiveStatus({ ...request, ...patch })).rejects.toThrow();
  expect(invoke).not.toHaveBeenCalled();
});
it("requires the explicit restore/null decision and rejects execution overrides", () => {
  expect(() => decodeAgentArchiveRequest({ operationId, id: conversationId, archived: false })).toThrow();
  expect(() => decodeAgentArchiveRequest({ ...request, force: true })).toThrow();
  expect(decodeAgentArchiveRequest({ ...request, expectedWatermark: 0 })).toEqual({ ...request, expectedWatermark: 0 });
});
it.each([
  { operationId: conversationId }, { conversationId: operationId }, { family: "agent.conversation.rename" },
  { result: { archived: true } }, { sqlFence: "01" },
])("rejects a mismatched proof without retry: %j", async patch => {
  const invoke = vi.fn().mockResolvedValue({ ...proof, ...patch });
  await expect(createAgentArchiveGateway(invoke).setArchived(request)).rejects.toThrow();
  expect(invoke).toHaveBeenCalledOnce();
});
it("keeps unknown failures intact without inferring permission from missing receipt", async () => {
  const failure = { code: "storage", reason: { code: "DATA_SQL_COMMIT_UNKNOWN", reason: { operationId } } };
  const invoke = vi.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce({ schemaVersion: 1, operationId, conversationId,
    status: { type: "unconfirmed", epoch, sqlFence: "17", blocked: true, closed: false, reason: "sql_commit_outcome_unknown" } });
  const gateway = createAgentArchiveGateway(invoke);
  await expect(gateway.setArchived(request)).rejects.toBe(failure);
  expect((await gateway.archiveStatus(request)).status.type).toBe("unconfirmed");
  expect(invoke).toHaveBeenCalledTimes(2);
});
it("validates status identity and rejects another family's proof", () => {
  const value = { schemaVersion: 1, operationId, conversationId, status: { type: "committed", proof } };
  expect(decodeAgentArchiveStatus(value).status.type).toBe("committed");
  expect(() => decodeAgentArchiveStatus({ ...value, operationId: conversationId })).toThrow();
  expect(() => decodeAgentArchiveStatus({ ...value, status: { type: "committed", proof: { ...proof, family: "agent.conversation.create_bound" } } })).toThrow();
});
