import { decodeAgentReadingNoteContextRequest, decodeAgentReadingNoteContextPreview,
  type AgentReadingNoteContextRequest, type AgentNoteContextPreview } from "@research-assistant/core/agent";
import type { AgentMetadataInvoke } from "./index";

export interface AgentReadingNoteContextGateway {
  /** Local retained reading-note preview, never a disclosure or linked-resource grant. */
  preview(request: AgentReadingNoteContextRequest): Promise<AgentNoteContextPreview>;
}
export function createAgentReadingNoteContextGateway(invoke: AgentMetadataInvoke): AgentReadingNoteContextGateway {
  return {async preview(request) {
    const frozen = decodeAgentReadingNoteContextRequest(request);
    const result = await invoke("agent_preview_reading_note_context", {request: {...frozen}});
    return decodeAgentReadingNoteContextPreview(result, frozen);
  }};
}
