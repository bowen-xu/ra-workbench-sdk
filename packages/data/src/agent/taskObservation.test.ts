import {expect, it, vi} from "vitest";
import {AgentTaskObservationDecodeError, decodeAgentTaskObservationResponse} from "@research-assistant/core/agent";
import {createAgentTaskObservationGateway} from "./taskObservation";

const id = (n: number) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
const request = {conversationId: id(1), turnId: id(2), runId: id(3)};
const response = (status: unknown) => ({schemaVersion: 1, ...request, status});
const diagnostic = {code: "context_persistence_failure", phase: "write", safeCause: "sql_write_failed",
  conversationId: request.conversationId, operationId: id(4), sqliteExtendedCode: 1811, callId: "fixture/call-1"};

it("uses the original three identities and retains safe recovery metadata", async () => {
  const invoke = vi.fn().mockResolvedValue(response({type: "finished", completion: "recoveryRequired", diagnostic}));
  const gateway = createAgentTaskObservationGateway(invoke);
  expect(await gateway.observe(request)).toEqual(response({type: "finished", completion: "recoveryRequired", diagnostic}));
  expect(invoke).toHaveBeenCalledExactlyOnceWith("agent_observe_task", {request});
  for (const key of ["conversationId", "turnId", "runId"] as const) {
    invoke.mockResolvedValueOnce({...response({type: "pending"}), [key]: id(4)});
    await expect(gateway.observe(request)).rejects.toBeInstanceOf(AgentTaskObservationDecodeError);
  }
});

it("preserves unavailable as unconfirmed and rejects untrusted or inconsistent payloads", () => {
  expect(decodeAgentTaskObservationResponse(response({type: "unavailable"})).status).toEqual({type: "unavailable"});
  expect(decodeAgentTaskObservationResponse(response({type: "pending"})).status).toEqual({type: "pending"});
  expect(decodeAgentTaskObservationResponse(response({type: "settled"})).status).toEqual({type: "settled"});
  const finished = (detail: unknown) => response({type: "finished", completion: "recoveryRequired", diagnostic: detail});
  const archive = {...diagnostic, requestId: id(4), resultId: id(5), childArchiveOperationId: id(6),
    childArchiveIntentVersion: 1, childArchiveExpectedWatermark: 12};
  expect(decodeAgentTaskObservationResponse(finished(archive)).status).toEqual({type: "finished", completion: "recoveryRequired", diagnostic: archive});
  for (const invalid of [
    response({type: "unavailable", completion: "failed"}),
    response({type: "settled", completion: "completed"}),
    response({type: "finished", completion: "success", diagnostic: null}),
    finished({...diagnostic, safeCause: "SELECT private"}),
    finished({...diagnostic, rawSql: "private"}),
    finished({...diagnostic, sqliteExtendedCode: -1}),
    finished({...diagnostic, operationId: "00000000-0000-0000-0000-000000000000"}),
    finished({...diagnostic, callId: "private text"}),
    finished({...diagnostic, callId: "K"}),
    finished({...diagnostic, childArchiveIntentVersion: 1}),
    {...response({type: "pending"}), runId: "00000000-0000-0000-0000-000000000000"},
  ]) expect(() => decodeAgentTaskObservationResponse(invalid)).toThrow(AgentTaskObservationDecodeError);
});

it("does not call a transport with an invalid task identity", async () => {
  const invoke = vi.fn();
  await expect(createAgentTaskObservationGateway(invoke).observe({...request, runId: ""})).rejects.toBeInstanceOf(AgentTaskObservationDecodeError);
  expect(invoke).not.toHaveBeenCalled();
});
