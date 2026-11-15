import { decodeAgentNoteContextPreview, decodeAgentNoteContextRequest,
  type AgentNoteContextPreview, type AgentNoteContextRequest } from "@research-assistant/core/agent";
import type { AgentMetadataInvoke } from "./index";

export interface AgentNoteContextGateway {
  /** Local saved-note preview only; this never grants model disclosure. */
  preview(request: AgentNoteContextRequest): Promise<AgentNoteContextPreview>;
}
export function createAgentNoteContextGateway(invoke: AgentMetadataInvoke): AgentNoteContextGateway {
  return {
    async preview(request) {
      const frozen = decodeAgentNoteContextRequest(request);
      const result = await invoke("agent_preview_note_context", { request: { ...frozen } });
      return decodeAgentNoteContextPreview(result, frozen);
    },
  };
}
