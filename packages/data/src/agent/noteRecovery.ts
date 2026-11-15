import {decodeAgentNoteRecoveryPage,decodeAgentNoteRecoveryRequest,type AgentNoteRecoveryPage,type AgentNoteRecoveryRequest} from "@research-assistant/core/agent";
import type {AgentMetadataInvoke} from "./index";

export interface AgentNoteRecoveryGateway {
  list(request:AgentNoteRecoveryRequest):Promise<AgentNoteRecoveryPage>;
}
export function createAgentNoteRecoveryGateway(invoke:AgentMetadataInvoke):AgentNoteRecoveryGateway {
  return {async list(request) {
    const frozen=decodeAgentNoteRecoveryRequest(request);
    return decodeAgentNoteRecoveryPage(await invoke("agent_list_unstarted_note_submissions",{request:{...frozen}}),frozen);
  }};
}
