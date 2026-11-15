import { decodeAgentReadingNoteReceipt, decodeAgentReadingNotePrepareRequest, decodeAgentReadingNoteSubmissionPreview, decodeAgentReadingNoteContextPreview,
  decodeAgentStartResponse, type AgentExecutionMode, type AgentStartResponse,
  type AgentReadingNoteReceipt, type AgentReadingNotePrepareRequest, type AgentReadingNoteSubmissionPreview } from "@research-assistant/core/agent";
import type { AgentMetadataInvoke } from "./index";

export interface AgentReadingNoteSubmissionGateway {
  prepare(request: AgentReadingNotePrepareRequest): Promise<AgentReadingNoteSubmissionPreview>;
  restore(request: AgentReadingNoteReceipt): Promise<AgentReadingNoteSubmissionPreview>;
  start(preview: AgentReadingNoteSubmissionPreview, mode: AgentExecutionMode): Promise<AgentStartResponse>;
}
function receive(value: unknown, receipt: AgentReadingNoteReceipt): AgentReadingNoteSubmissionPreview {
  const result = decodeAgentReadingNoteSubmissionPreview(value);
  if (result.conversationId !== receipt.conversationId || result.requestId !== receipt.requestId || result.readingNoteId !== receipt.readingNoteId) throw new Error("Mismatched reading note receipt");
  return result;
}
export function createAgentReadingNoteSubmissionGateway(invoke: AgentMetadataInvoke): AgentReadingNoteSubmissionGateway {
  return {
    async prepare(request) {
      const frozen = decodeAgentReadingNotePrepareRequest(request);
      const result = receive(await invoke("agent_prepare_reading_note_submission", {request: {...frozen, context: {...frozen.context}, model: frozen.model ? {...frozen.model} : null}}),
        {conversationId: frozen.conversationId, requestId: frozen.requestId, readingNoteId: frozen.context.readingNoteId});
      if (result.input.text !== frozen.text || (frozen.model && (result.input.model.providerId !== frozen.model.providerId || result.input.model.modelId !== frozen.model.modelId
        || result.input.reasoningEffort !== (frozen.model.reasoningEffort ?? null)))) throw new Error("Mismatched reading note input");
      const source = result.input.context.find(item => item.kind === "note");
      if (!source) throw new Error("Missing reading note context");
      decodeAgentReadingNoteContextPreview({schemaVersion: 1, source}, frozen.context);
      return result;
    },
    async restore(request) {
      const frozen = decodeAgentReadingNoteReceipt(request);
      return receive(await invoke("agent_restore_reading_note_submission", {request: {...frozen}}), frozen);
    },
    async start(preview, mode) {
      const frozen = decodeAgentReadingNoteSubmissionPreview(preview);
      if (mode !== "deepSeekNonThinking" && mode !== "chatGptDefault") throw new Error("Invalid reading note execution mode");
      const result = decodeAgentStartResponse(await invoke("agent_start_reading_note_submission", {request: {
        conversationId: frozen.conversationId, requestId: frozen.requestId, readingNoteId: frozen.readingNoteId,
        contextSnapshotId: frozen.contextSnapshotId, model: {...frozen.input.model}, mode,
      }}));
      if (result.conversationId !== frozen.conversationId || result.requestId !== frozen.requestId || result.turnId !== frozen.turnId) throw new Error("Mismatched reading note start result");
      return result;
    },
  };
}
