import {decodeAgentReadingNoteRecoveryPage,decodeAgentReadingNoteRecoveryRequest,type AgentReadingNoteRecoveryPage,type AgentReadingNoteRecoveryRequest} from "@research-assistant/core/agent";
import type {AgentMetadataInvoke} from "./index";

export interface AgentReadingNoteRecoveryGateway {
  list(request:AgentReadingNoteRecoveryRequest):Promise<AgentReadingNoteRecoveryPage>;
}
export function createAgentReadingNoteRecoveryGateway(invoke:AgentMetadataInvoke):AgentReadingNoteRecoveryGateway {
  return {async list(request) {
    const frozen=decodeAgentReadingNoteRecoveryRequest(request);
    return decodeAgentReadingNoteRecoveryPage(await invoke("agent_list_unstarted_reading_note_submissions",{request:{...frozen}}),frozen);
  }};
}
