import {AgentTaskObservationDecodeError, decodeAgentTaskObservationRequest, decodeAgentTaskObservationResponse,
  type AgentTaskObservationRequest, type AgentTaskObservationResponse} from "@research-assistant/core/agent";
import type {AgentMetadataInvoke} from "./index";

export interface AgentTaskObservationGateway {
  observe(request: AgentTaskObservationRequest): Promise<AgentTaskObservationResponse>;
}
export function createAgentTaskObservationGateway(invoke: AgentMetadataInvoke): AgentTaskObservationGateway {
  return {async observe(input) {
    const request = decodeAgentTaskObservationRequest(input);
    const result = decodeAgentTaskObservationResponse(await invoke("agent_observe_task", {request}));
    if (result.conversationId !== request.conversationId || result.turnId !== request.turnId || result.runId !== request.runId)
      throw Object.assign(new AgentTaskObservationDecodeError(), {code: "AGENT_TASK_OBSERVATION_IDENTITY_MISMATCH"});
    return result;
  }};
}
