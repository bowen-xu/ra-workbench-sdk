import { AgentSubmissionDecodeError, decodeAgentWritingQueuePreviewRequest, decodeAgentWritingQueuePrepareResult,
  decodeAgentWritingQueuePrepareStatusResponse, sameAgentWritingQueuePreviewRequest, type AgentWritingQueuePrepareStatusResponse,
  decodeAgentWritingQueueScope, type AgentWritingQueueScope, decodeAgentWritingQueuePreview, decodeAgentWritingStartResponse,
  decodeAgentWritingQueueCancelRequest, decodeAgentWritingQueueCancelResult, decodeAgentWritingQueueCancelStatusResponse,
  decodeAgentWritingQueuedStartRequest, decodeAgentWritingQueuedStartStatusResponse, sameAgentWritingQueuedStartRequest,
  type AgentWritingQueuedStartStatusResponse,
  type AgentWritingQueueCancelStatusResponse,
  type AgentWritingQueuedStartRequest, type AgentWritingStartResponse,
  type AgentWritingQueuePreviewRequest, type AgentWritingQueuePreviewResponse,
  type AgentWritingQueueCancelRequest, type AgentWritingQueueResponse } from "@research-assistant/core/agent";
import type { AgentMetadataInvoke } from "./index";
export interface AgentInputQueuePreviewGateway {
  recover(request: AgentWritingQueueScope): Promise<AgentWritingQueuePreviewResponse | null>;
  start(request: AgentWritingQueuedStartRequest): Promise<AgentWritingStartResponse>;
  startStatus(request: AgentWritingQueuedStartRequest): Promise<AgentWritingQueuedStartStatusResponse>;
  prepare(request: AgentWritingQueuePreviewRequest): Promise<AgentWritingQueuePreviewResponse>;
  prepareStatus(request: AgentWritingQueuePreviewRequest): Promise<AgentWritingQueuePrepareStatusResponse>;
  cancel(request: AgentWritingQueueCancelRequest): Promise<AgentWritingQueueResponse>;
  /** Inspect the exact frozen cancellation; never replays or starts work. */
  cancelStatus(request: AgentWritingQueueCancelRequest): Promise<AgentWritingQueueCancelStatusResponse>;
}
export function createAgentInputQueuePreviewGateway(invoke: AgentMetadataInvoke): AgentInputQueuePreviewGateway {
  return {
    async recover(input) {
      const request = decodeAgentWritingQueueScope(input);
      const raw = await invoke("agent_read_pending_writing_queue_preview", { request });
      if (raw === null) return null;
      const result = decodeAgentWritingQueuePreview(raw);
      if (result.preview.conversationId !== request.conversationId || result.preview.manuscriptId !== request.manuscriptId)
        throw new AgentSubmissionDecodeError();
      return result;
    },
    async start(input) {
      const request = decodeAgentWritingQueuedStartRequest(input);
      const result = decodeAgentWritingStartResponse(await invoke("agent_start_writing_queued_submission", { request }));
      if (result.conversationId !== request.start.conversationId.toLowerCase()
        || result.requestId !== request.start.requestId.toLowerCase()) throw new AgentSubmissionDecodeError();
      return result;
    },
    async startStatus(input) {
      const request = decodeAgentWritingQueuedStartRequest(input);
      const response = decodeAgentWritingQueuedStartStatusResponse(await invoke("agent_read_writing_queued_start_status", {request}));
      if (!sameAgentWritingQueuedStartRequest(request, response.intent)) throw new AgentSubmissionDecodeError();
      return response;
    },
    async prepare(input) {
      const request = decodeAgentWritingQueuePreviewRequest(input);
      return decodeAgentWritingQueuePrepareResult(await invoke("agent_prepare_writing_queue_preview", { request }), request);
    },
    async prepareStatus(input) {
      const request = decodeAgentWritingQueuePreviewRequest(input);
      const result = decodeAgentWritingQueuePrepareStatusResponse(await invoke("agent_read_writing_queue_preview_prepare_status", { request }));
      if (!sameAgentWritingQueuePreviewRequest(request, result.intent)) throw new AgentSubmissionDecodeError();
      return result;
    },
    async cancel(input) {
      const request = decodeAgentWritingQueueCancelRequest(input);
      return decodeAgentWritingQueueCancelResult(await invoke("agent_cancel_writing_queue_preview", { request }), request);
    },
    async cancelStatus(input) {
      const request = decodeAgentWritingQueueCancelRequest(input);
      const result = decodeAgentWritingQueueCancelStatusResponse(await invoke("agent_read_writing_queue_preview_cancel_status", { request }));
      if (Object.keys(request).some(field => request[field as keyof AgentWritingQueueCancelRequest]
        !== result.intent[field as keyof AgentWritingQueueCancelRequest])) throw new AgentSubmissionDecodeError();
      return result;
    },
  };
}
