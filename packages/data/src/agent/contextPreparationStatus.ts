import {decodeAgentContextPrepareIntent, decodeAgentContextPrepareStatusResponse, decodeAgentDeletionWriteOptions,
  sameAgentContextPrepareIntent, type AgentContextPrepareIntent, type AgentContextPrepareRequest, type AgentContextPrepareStatusResponse} from "@research-assistant/core/agent";
import type {AgentMetadataInvoke} from "./index";

export interface AgentContextPrepareStatusGateway {
  read(request: AgentContextPrepareRequest | AgentContextPrepareIntent, options?: {readonly expectedEpoch: string}): Promise<AgentContextPrepareStatusResponse>;
}
export interface AgentContextPrepareProvenGateway {
  prepare(request: AgentContextPrepareRequest | AgentContextPrepareIntent, options?: {readonly expectedEpoch: string}): Promise<Extract<AgentContextPrepareStatusResponse["status"], {type: "committed"}>>;
}
function guard(options?: {readonly expectedEpoch: string}) {return options === undefined ? undefined : decodeAgentDeletionWriteOptions(options);}
function validate(value: unknown, intent: AgentContextPrepareIntent, epoch: string | null): AgentContextPrepareStatusResponse {
  const response = decodeAgentContextPrepareStatusResponse(value);
  if (!sameAgentContextPrepareIntent(intent, response.intent) || response.expectedEpoch !== epoch) throw new Error("Mismatched context preparation intent");
  return response;
}
export function createAgentContextPrepareStatusGateway(invoke: AgentMetadataInvoke): AgentContextPrepareStatusGateway {
  return {async read(request, options) {
    const intent = decodeAgentContextPrepareIntent(request), expected = guard(options);
    return validate(await invoke("agent_read_context_submission_prepare_status", {request: intent, ...(expected ?? {})}), intent, expected?.expectedEpoch ?? null);
  }};
}
export function createAgentContextPrepareProvenGateway(invoke: AgentMetadataInvoke): AgentContextPrepareProvenGateway {
  return {async prepare(request, options) {
    const intent = decodeAgentContextPrepareIntent(request), expected = guard(options);
    const response = validate(await invoke("agent_prepare_context_submission_proven", {request: intent, ...(expected ?? {})}), intent, expected?.expectedEpoch ?? null);
    if (response.status.type !== "committed") throw new Error("Context preparation proof unavailable");
    return response.status;
  }};
}
