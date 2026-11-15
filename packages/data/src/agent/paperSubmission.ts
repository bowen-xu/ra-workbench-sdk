import {
  decodeAgentPaperSubmissionPrepareRequest, decodeAgentPaperSubmissionPreview,
  decodeAgentPaperSubmissionReceipt, decodeAgentStartResponse,
  decodeAgentPaperSteerRequest, decodeAgentPaperSteerResponse,
  decodeAgentPaperTurnSourcesRequest, decodeAgentPaperTurnSourcesResponse,
  decodeAgentDeletionWriteOptions,
  type AgentExecutionMode, type AgentPaperSubmissionPrepareRequest,
  type AgentPaperSubmissionPreview, type AgentPaperSubmissionReceipt, type AgentStartResponse,
  type AgentPaperSteerRequest, type AgentPaperSteerResponse,
  type AgentPaperTurnSourcesRequest, type AgentPaperTurnSourcesResponse,
} from "@research-assistant/core/agent";
import type { AgentMetadataInvoke } from "./index";

export interface AgentPaperSubmissionGateway {
  prepare(request: AgentPaperSubmissionPrepareRequest): Promise<AgentPaperSubmissionPreview>;
  restore(request: AgentPaperSubmissionReceipt): Promise<AgentPaperSubmissionPreview>;
  start(preview: AgentPaperSubmissionPreview, mode: AgentExecutionMode, options?: {readonly expectedEpoch: string}): Promise<AgentStartResponse>;
  steer(request: AgentPaperSteerRequest): Promise<AgentPaperSteerResponse>;
  sources(request: AgentPaperTurnSourcesRequest): Promise<AgentPaperTurnSourcesResponse>;
}

function receive(value: unknown, expected: AgentPaperSubmissionReceipt): AgentPaperSubmissionPreview {
  const result = decodeAgentPaperSubmissionPreview(value);
  if (result.conversationId !== expected.conversationId || result.requestId !== expected.requestId
    || result.paperId !== expected.paperId || result.paperContextSnapshotId !== expected.paperContextSnapshotId) {
    throw new Error("Mismatched paper submission receipt");
  }
  return result;
}

export function createAgentPaperSubmissionGateway(invoke: AgentMetadataInvoke): AgentPaperSubmissionGateway {
  return {
    async prepare(request) {
      const frozen = decodeAgentPaperSubmissionPrepareRequest(request);
      const result = receive(await invoke("agent_prepare_paper_submission", { request: {
        ...frozen, model: frozen.model ? { ...frozen.model } : null,
      } }), {
        conversationId: frozen.conversationId, requestId: frozen.requestId,
        paperId: frozen.paperId, paperContextSnapshotId: frozen.paperContextSnapshotId,
      });
      if (result.input.text !== frozen.text || (frozen.model && (
        result.input.model.providerId !== frozen.model.providerId
        || result.input.model.modelId !== frozen.model.modelId
        || result.input.reasoningEffort !== (frozen.model.reasoningEffort ?? null)))) {
        throw new Error("Mismatched paper submission input");
      }
      return result;
    },
    async restore(request) {
      const frozen = decodeAgentPaperSubmissionReceipt(request);
      return receive(await invoke("agent_restore_paper_submission", { request: { ...frozen } }), frozen);
    },
    async start(preview, mode, options) {
      const frozen = decodeAgentPaperSubmissionPreview(preview);
      const guard = options === undefined ? undefined : decodeAgentDeletionWriteOptions(options);
      if (mode !== "deepSeekNonThinking" && mode !== "chatGptDefault") throw new Error("Invalid paper execution mode");
      const result = decodeAgentStartResponse(await invoke("agent_start_paper_submission", { request: {
        conversationId: frozen.conversationId, requestId: frozen.requestId, paperId: frozen.paperId,
        paperContextSnapshotId: frozen.paperContextSnapshotId, contextSnapshotId: frozen.contextSnapshotId,
        model: { ...frozen.input.model }, mode,
      }, ...(guard ?? {}) }));
      if (result.conversationId !== frozen.conversationId || result.requestId !== frozen.requestId || result.turnId !== frozen.turnId) {
        throw new Error("Mismatched paper start result");
      }
      return result;
    },
    async steer(request) {
      const frozen = decodeAgentPaperSteerRequest(request);
      const result = decodeAgentPaperSteerResponse(await invoke("agent_steer_paper_turn", { request: frozen }));
      if (result.conversationId !== frozen.conversationId || result.turnId !== frozen.turnId || result.inputId !== frozen.inputId) throw new Error("Mismatched paper steering result");
      return result;
    },
    async sources(request) {
      const frozen = decodeAgentPaperTurnSourcesRequest(request);
      const result = decodeAgentPaperTurnSourcesResponse(await invoke("agent_read_paper_turn_sources", { request: frozen }), frozen);
      if (result.conversationId !== frozen.conversationId || result.paperId !== frozen.paperId || result.turnId !== frozen.turnId) {
        throw new Error("Mismatched paper source result");
      }
      return result;
    },
  };
}
