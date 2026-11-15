import {
  AgentSubmissionDecodeError, decodeAgentWritingQueuedCompactionPrepareRequest,
  decodeAgentWritingQueuedCompactionPreview, decodeAgentWritingQueuedCompactionReadRequest,
  decodeAgentWritingQueuedCompactionReadResponse, decodeAgentWritingQueuedCompactionSettleRequest,
  decodeAgentWritingQueuedCompactionSettleResponse,
  type AgentWritingQueuedCompactionPrepareRequest, type AgentWritingQueuedCompactionPreview,
  type AgentWritingQueuedCompactionReadRequest, type AgentWritingQueuedCompactionReadResponse,
  type AgentWritingQueuedCompactionSettleRequest, type AgentWritingQueuedCompactionSettleResponse,
} from "@research-assistant/core/agent";
import type { AgentMetadataInvoke } from "./index";

/** Queued commands use the same native compaction task. These ports only bind
 * its immutable request to a queue claim and acknowledge a proven terminal. */
export interface AgentWritingQueuedCompactionGateway {
  prepareWritingQueued(request: AgentWritingQueuedCompactionPrepareRequest): Promise<AgentWritingQueuedCompactionPreview>;
  readWritingQueued(request: AgentWritingQueuedCompactionReadRequest): Promise<AgentWritingQueuedCompactionReadResponse>;
  settleWritingQueued(request: AgentWritingQueuedCompactionSettleRequest): Promise<AgentWritingQueuedCompactionSettleResponse>;
}

export function createAgentWritingQueuedCompactionGateway(invoke: AgentMetadataInvoke): AgentWritingQueuedCompactionGateway {
  return {
    async prepareWritingQueued(input) {
      const request = decodeAgentWritingQueuedCompactionPrepareRequest(input);
      const identity = decodeAgentWritingQueuedCompactionReadRequest({ inputId: request.inputId,
        conversationId: request.submission.conversationId, manuscriptId: request.submission.context.manuscriptId,
        requestId: request.submission.requestId });
      const response = decodeAgentWritingQueuedCompactionPreview(await invoke("agent_prepare_writing_queued_compaction", { request }));
      if (response.retirement || response.inputId !== identity.inputId || response.requestId !== identity.requestId
        || response.preview.conversationId !== identity.conversationId || response.preview.manuscriptId !== identity.manuscriptId
        || response.claimRevision !== request.expectedQueueRevision || response.expectedRevision !== request.expectedRevision
        || response.queue.revision !== request.expectedQueueRevision + 1 || response.queue.preparingInputId !== identity.inputId
        || response.preview.input.text !== request.submission.text || (request.submission.model != null
          && (response.preview.input.model.providerId !== request.submission.model.providerId
            || response.preview.input.model.modelId !== request.submission.model.modelId))) throw new AgentSubmissionDecodeError();
      return response;
    },
    async readWritingQueued(input) {
      const request = decodeAgentWritingQueuedCompactionReadRequest(input);
      const response = decodeAgentWritingQueuedCompactionReadResponse(await invoke("agent_read_writing_queued_compaction", { request }));
      if (response === null) return null;
      const prepared = response.kind === "compact" ? response : response.preview;
      if (prepared.inputId !== request.inputId || prepared.preview.conversationId !== request.conversationId
        || prepared.preview.manuscriptId !== request.manuscriptId
        || (request.requestId !== null && prepared.preview.requestId !== request.requestId)) throw new AgentSubmissionDecodeError();
      return response;
    },
    async settleWritingQueued(input) {
      const request = decodeAgentWritingQueuedCompactionSettleRequest(input);
      const response = decodeAgentWritingQueuedCompactionSettleResponse(await invoke("agent_settle_writing_queued_compaction", { request }));
      const retained = response.queue.inputs.some(item => item.inputId === request.inputId);
      if (response.inputId !== request.inputId || response.requestId !== request.requestId
        || response.queue.conversationId !== request.conversationId || response.queue.manuscriptId !== request.manuscriptId
        || response.queue.revision !== request.expectedQueueRevision + 1 || response.queue.preparingInputId !== null
        || (response.outcome === "completed" ? retained : !retained || !response.queue.paused)) throw new AgentSubmissionDecodeError();
      return response;
    },
  };
}
