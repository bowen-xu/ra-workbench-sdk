import {
  AgentSubmissionDecodeError, decodeAgentCompactionStartRequest, decodeAgentStartResponse,
  agentWritingCompactionStartRequest, decodeAgentWritingCompactionPreview, decodeAgentWritingCompactionPrepareRequest,
  decodeAgentWritingCompactionPrepareStatusResponse, sameAgentWritingCompactionPrepareRequest, type AgentWritingCompactionPrepareStatusResponse,
  decodeAgentWritingPrepareResult,
  decodeAgentWritingCompactionStartStatusResponse, sameAgentWritingCompactionStartRequest, type AgentWritingCompactionStartStatusResponse,
  type AgentCompactionStartRequest, type AgentStartResponse, type AgentWritingCompactionPrepareRequest,
  type AgentWritingCompactionPreview, type AgentWritingReceipt,
} from "@research-assistant/core/agent";
import type { AgentMetadataInvoke } from "./index";
import { createAgentWritingQueuedCompactionGateway, type AgentWritingQueuedCompactionGateway } from "./queuedCompaction";

/** Native owns execution after admission; completion comes from durable history. */
export interface AgentCompactionGateway {
  start(request: AgentCompactionStartRequest): Promise<AgentStartResponse>;
}
export interface AgentWritingCompactionGateway extends AgentCompactionGateway, AgentWritingQueuedCompactionGateway {
  startStatus(request: AgentCompactionStartRequest): Promise<AgentWritingCompactionStartStatusResponse>;
  prepareWriting(request: AgentWritingCompactionPrepareRequest): Promise<AgentWritingCompactionPreview>;
  prepareWritingStatus(request: AgentWritingCompactionPrepareRequest): Promise<AgentWritingCompactionPrepareStatusResponse>;
  restoreWriting(request: AgentWritingReceipt): Promise<AgentWritingCompactionPreview>;
}

function checkReceipt(response: AgentWritingCompactionPreview, request: AgentWritingReceipt): void {
  const frozen = agentWritingCompactionStartRequest(response);
  const expected = decodeAgentCompactionStartRequest({ ...frozen, conversationId: request.conversationId,
    requestId: request.requestId, host: { kind: "manuscript", manuscriptId: request.manuscriptId } });
  if (frozen.conversationId !== expected.conversationId || frozen.requestId !== expected.requestId
    || frozen.host.kind !== "manuscript" || expected.host.kind !== "manuscript"
    || frozen.host.manuscriptId !== expected.host.manuscriptId) throw new AgentSubmissionDecodeError();
}

export function createAgentCompactionGateway(invoke: AgentMetadataInvoke): AgentWritingCompactionGateway {
  return {
    ...createAgentWritingQueuedCompactionGateway(invoke),
    async prepareWriting(request) {
      const frozen = decodeAgentWritingCompactionPrepareRequest(request);
      const response = decodeAgentWritingCompactionPreview(await invoke("agent_prepare_writing_compaction", { request: frozen.request, expectedRevision: frozen.expectedRevision }));
      decodeAgentWritingPrepareResult(response.preview, frozen.request);
      checkReceipt(response, { conversationId: frozen.request.conversationId, requestId: frozen.request.requestId, manuscriptId: frozen.request.context.manuscriptId });
      if (response.expectedRevision !== frozen.expectedRevision || (frozen.request.model != null
        && (response.preview.input.model.providerId !== frozen.request.model.providerId || response.preview.input.model.modelId !== frozen.request.model.modelId))) throw new AgentSubmissionDecodeError();
      return response;
    },
    async prepareWritingStatus(input) {
      const request = decodeAgentWritingCompactionPrepareRequest(input), response = decodeAgentWritingCompactionPrepareStatusResponse(await invoke("agent_read_writing_compaction_prepare_status", {request: request.request, expectedRevision: request.expectedRevision}));
      if (!sameAgentWritingCompactionPrepareRequest(request, response.intent)) throw new AgentSubmissionDecodeError(); return response;
    },
    async restoreWriting(request) {
      const frozen = { ...request };
      const response = decodeAgentWritingCompactionPreview(await invoke("agent_restore_writing_compaction", { request: frozen }));
      checkReceipt(response, frozen);
      decodeAgentWritingPrepareResult(response.preview, {conversationId: frozen.conversationId.toLowerCase(), requestId: frozen.requestId.toLowerCase(), context: {manuscriptId: frozen.manuscriptId.toLowerCase(), files: []}});
      return response;
    },
    async start(request) {
      const frozen = decodeAgentCompactionStartRequest(request);
      const response = decodeAgentStartResponse(await invoke("agent_start_compaction", { request: frozen }));
      if (response.conversationId !== frozen.conversationId || response.requestId !== frozen.requestId) throw new AgentSubmissionDecodeError();
      return response;
    },
    async startStatus(input) {
      const request = decodeAgentCompactionStartRequest(input);
      if (request.host.kind !== "manuscript" || request.host.manuscriptId === "00000000-0000-0000-0000-000000000000") throw new AgentSubmissionDecodeError();
      const response = decodeAgentWritingCompactionStartStatusResponse(await invoke("agent_read_writing_compaction_start_status", {request}));
      if (!sameAgentWritingCompactionStartRequest(request, response.intent)) throw new AgentSubmissionDecodeError(); return response;
    },
  };
}
