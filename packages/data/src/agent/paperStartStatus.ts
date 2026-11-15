import {decodeAgentPaperStartRequest, decodeAgentPaperStartStatusResponse, decodeAgentDeletionWriteOptions, sameAgentPaperStartRequest,
  type AgentPaperStartRequest, type AgentPaperStartStatusResponse} from "@research-assistant/core/agent";
import type {AgentMetadataInvoke} from "./index";
export interface AgentPaperStartStatusGateway {read(request: AgentPaperStartRequest, options?: {readonly expectedEpoch: string}): Promise<AgentPaperStartStatusResponse>}
export function createAgentPaperStartStatusGateway(invoke: AgentMetadataInvoke): AgentPaperStartStatusGateway {
  return {async read(request, options) {
    const intent = decodeAgentPaperStartRequest(request);
    const guard = options === undefined ? undefined : decodeAgentDeletionWriteOptions(options);
    const response = decodeAgentPaperStartStatusResponse(await invoke("agent_read_paper_start_status", {request: structuredClone(intent), ...(guard ?? {})}));
    if (!sameAgentPaperStartRequest(intent, response.intent) || guard && response.status.type === "unconfirmed" && response.status.detail.epoch !== null && response.status.detail.epoch !== guard.expectedEpoch) throw new Error("Mismatched paper start intent");
    return response;
  }};
}
