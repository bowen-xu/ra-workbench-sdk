import {expect, it, vi} from "vitest";
import golden from "../../../../tests/fixtures/agent-queue-edit-status-native-v1.json";
import {decodeAgentQueueStorageFailure} from "@research-assistant/core/agent";
import {createAgentInputQueueGateway} from "./inputQueue";
import {createAgentPaperQueueGateway} from "./paperQueue";
import {createAgentNoteQueueGateway} from "./noteQueue";
import {createAgentContextQueueGateway} from "./contextQueue";
import type {AgentMetadataInvoke} from "./index";
import type {AgentQueueEditInspection} from "./queueEditInspection";

const hosts: Record<string, {command: string; create(invoke: AgentMetadataInvoke): AgentQueueEditInspection<unknown>}> = {
  manuscript: {command: "agent_read_writing_input_queue_edit_status", create: createAgentInputQueueGateway},
  paper: {command: "agent_read_paper_input_queue_edit_status", create: createAgentPaperQueueGateway},
  note: {command: "agent_read_note_input_queue_edit_status", create: createAgentNoteQueueGateway},
  readingNote: {command: "agent_read_note_input_queue_edit_status", create: createAgentNoteQueueGateway},
  context: {command: "agent_read_context_input_queue_edit_status", create: createAgentContextQueueGateway},
};
const scopes = golden.scopes.map(sample => ({kind: sample.committed.intent.scope.kind, ...sample}));

it.each(scopes)("$kind inspects real Native samples using only its original status command", async sample => {
  const host = hosts[sample.kind]!;
  for (const value of [sample.committed, sample.notFound]) {
    const invoke = vi.fn(async (_command: string, _args: Record<string, unknown>) => value);
    expect(await host.create(invoke).inspectEdit(sample.request)).toEqual(value);
    expect(invoke).toHaveBeenCalledExactlyOnceWith(host.command, {request: sample.request});
  }
});

it.each(scopes)("$kind propagates actual changed-revision storage failure without retrying the write", async sample => {
  const host = hosts[sample.kind]!, request = {...sample.request, expectedRevision: 1};
  const invoke = vi.fn(async (_command: string, _args: Record<string, unknown>) => {throw sample.storageFailure;});
  await expect(host.create(invoke).inspectEdit(request)).rejects.toBe(sample.storageFailure);
  expect(invoke).toHaveBeenCalledExactlyOnceWith(host.command, {request});
  expect(decodeAgentQueueStorageFailure(sample.storageFailure, request)).toMatchObject({
    operationId: request.requestId, scope: sample.committed.intent.scope,
    reason: {code: "DATA_SQL_OPERATION_CONFLICT", diagnostic: sample.storageFailure.reason.reason},
  });
});
