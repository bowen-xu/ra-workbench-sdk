import {
  AgentNoteSubmissionDecodeError, decodeAgentNoteContextPreview, decodeAgentNotePrepareRequest,
  decodeAgentNoteReceipt, decodeAgentNoteSubmissionPreview, decodeAgentStartResponse,
  type AgentExecutionMode, type AgentNotePrepareRequest, type AgentNoteReceipt,
  type AgentNoteSubmissionPreview, type AgentStartResponse,
} from "@research-assistant/core/agent";
import type { AgentMetadataInvoke } from "./index";

export interface AgentNoteSubmissionGateway {
  prepare(request: AgentNotePrepareRequest): Promise<AgentNoteSubmissionPreview>;
  restore(request: AgentNoteReceipt): Promise<AgentNoteSubmissionPreview>;
  /** Explicit start of the exact reviewed preview; preparation never starts it. */
  start(preview: AgentNoteSubmissionPreview, mode: AgentExecutionMode): Promise<AgentStartResponse>;
}
function fail(): never { throw new AgentNoteSubmissionDecodeError(); }
function receive(value: unknown, expected: AgentNoteReceipt): AgentNoteSubmissionPreview {
  const result = decodeAgentNoteSubmissionPreview(value);
  if (result.conversationId !== expected.conversationId || result.requestId !== expected.requestId || result.pageId !== expected.pageId) return fail();
  return result;
}
export function createAgentNoteSubmissionGateway(invoke: AgentMetadataInvoke): AgentNoteSubmissionGateway {
  return {
    async prepare(request) {
      const frozen = decodeAgentNotePrepareRequest(request);
      const result = receive(await invoke("agent_prepare_note_submission", { request: {
        ...frozen, context: { ...frozen.context }, model: frozen.model ? { ...frozen.model } : null,
      } }), { conversationId: frozen.conversationId, requestId: frozen.requestId, pageId: frozen.context.pageId });
      if (result.input.text !== frozen.text || (frozen.model && (
        result.input.model.providerId !== frozen.model.providerId || result.input.model.modelId !== frozen.model.modelId
        || result.input.reasoningEffort !== (frozen.model.reasoningEffort ?? null)))) return fail();
      try { const source = result.input.context.find(item => item.kind === "note"); if (!source) return fail(); decodeAgentNoteContextPreview({ schemaVersion: 1, source }, frozen.context); }
      catch { return fail(); }
      return result;
    },
    async restore(request) {
      const frozen = decodeAgentNoteReceipt(request);
      return receive(await invoke("agent_restore_note_submission", { request: { ...frozen } }), frozen);
    },
    async start(preview, mode) {
      const frozen = decodeAgentNoteSubmissionPreview(preview);
      if (mode !== "deepSeekNonThinking" && mode !== "chatGptDefault") return fail();
      const result = decodeAgentStartResponse(await invoke("agent_start_note_submission", { request: {
        conversationId: frozen.conversationId, requestId: frozen.requestId, pageId: frozen.pageId,
        contextSnapshotId: frozen.contextSnapshotId, model: { ...frozen.input.model }, mode,
      } }));
      if (result.conversationId !== frozen.conversationId || result.requestId !== frozen.requestId || result.turnId !== frozen.turnId) return fail();
      return result;
    },
  };
}
