import {
  decodeAgentWritingStartResponse, AgentSubmissionDecodeError, decodeAgentWritingPrepareRequest, decodeAgentWritingPrepareResult,
  decodeAgentWritingPrepareStatusResponse, sameAgentWritingPrepareRequest, type AgentWritingPrepareStatusResponse,
  decodeAgentWritingStartRequest, decodeAgentWritingStartStatusResponse, sameAgentWritingStartRequest, type AgentWritingStartStatusResponse,
  type AgentWritingStartRequest, type AgentWritingStartResponse,
  type AgentSubmissionPreview, type AgentWritingPrepareRequest, type AgentWritingReceipt,
} from "@research-assistant/core/agent";
import type { AgentMetadataInvoke } from "./index";
import { decodeAgentWritingSteerResponse, type AgentWritingSteerRequest, type AgentWritingSteerResponse } from "@research-assistant/core/agent";

export interface AgentSteeringGateway {
  steerWriting(request: AgentWritingSteerRequest): Promise<AgentWritingSteerResponse>;
}
export function createAgentSteeringGateway(invoke: AgentMetadataInvoke): AgentSteeringGateway {
  return {
    async steerWriting(request) {
      const response = decodeAgentWritingSteerResponse(await invoke("agent_steer_writing_turn", { request }));
      if (response.conversationId !== request.conversationId.toLowerCase() || response.turnId !== request.turnId.toLowerCase() || response.inputId !== request.inputId.toLowerCase()) throw new AgentSubmissionDecodeError();
      return response;
    },
  };
}

export interface AgentSubmissionGateway {
  startWriting(request: AgentWritingStartRequest): Promise<AgentWritingStartResponse>;
  startStatus(request: AgentWritingStartRequest): Promise<AgentWritingStartStatusResponse>;
  prepareWriting(request: AgentWritingPrepareRequest): Promise<AgentSubmissionPreview>;
  prepareWritingStatus(request: AgentWritingPrepareRequest): Promise<AgentWritingPrepareStatusResponse>;
  restoreWriting(request: AgentWritingReceipt): Promise<AgentSubmissionPreview>;
}
/** Preparation is local. Only explicit startWriting admits a model run. */
export function createAgentSubmissionGateway(invoke: AgentMetadataInvoke): AgentSubmissionGateway {
  async function receive(command: string, request: AgentWritingPrepareRequest | AgentWritingReceipt, manuscriptId: string) {
    const response = decodeAgentWritingPrepareResult(await invoke(command, { request }), {conversationId: request.conversationId.toLowerCase(), requestId: request.requestId.toLowerCase(),
      context: {manuscriptId: manuscriptId.toLowerCase(), files: []}});
    if (response.conversationId !== request.conversationId.toLowerCase() || response.requestId !== request.requestId.toLowerCase() || response.manuscriptId !== manuscriptId.toLowerCase()) throw new AgentSubmissionDecodeError();
    return response;
  }
  return {
    async startWriting(input) {
      const request = decodeAgentWritingStartRequest(input);
      const response = decodeAgentWritingStartResponse(await invoke("agent_start_writing_submission", { request }));
      if (response.conversationId !== request.conversationId.toLowerCase() || response.requestId !== request.requestId.toLowerCase()) throw new AgentSubmissionDecodeError();
      return response;
    },
    async startStatus(input) {
      const request = decodeAgentWritingStartRequest(input);
      const response = decodeAgentWritingStartStatusResponse(await invoke("agent_read_writing_start_status", {request}));
      if (!sameAgentWritingStartRequest(request, response.intent)) throw new AgentSubmissionDecodeError(); return response;
    },
    prepareWriting(input) {const request = decodeAgentWritingPrepareRequest(input); return receive("agent_prepare_writing_submission", request, request.context.manuscriptId);},
    async prepareWritingStatus(input) {
      const request = decodeAgentWritingPrepareRequest(input), response = decodeAgentWritingPrepareStatusResponse(await invoke("agent_read_writing_submission_prepare_status", {request}));
      if (!sameAgentWritingPrepareRequest(request, response.intent)) throw new AgentSubmissionDecodeError(); return response;
    },
    restoreWriting: (request) => receive("agent_restore_writing_submission", request, request.manuscriptId),
  };
}
