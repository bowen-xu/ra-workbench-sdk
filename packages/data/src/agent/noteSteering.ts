import {AgentSubmissionDecodeError,decodeAgentNoteSteerRequest,decodeAgentNoteSteerResponse,decodeAgentNoteSteeringScope,decodeAgentNoteSteeringRecovery,
  type AgentNoteSteerRequest,type AgentNoteSteerResponse,type AgentNoteSteeringScope,type AgentNoteSteeringRecovery} from "@research-assistant/core/agent";
import type {AgentMetadataInvoke} from "./index";

export interface AgentNoteSteeringGateway {
  steer(request:AgentNoteSteerRequest):Promise<AgentNoteSteerResponse>;
  recover(request:AgentNoteSteeringScope):Promise<AgentNoteSteeringRecovery>;
}
/** Admission is not consumption. Recovery is read-only and neither method retries itself. */
export function createAgentNoteSteeringGateway(invoke:AgentMetadataInvoke):AgentNoteSteeringGateway {
  return {
    async steer(input){
      const request=decodeAgentNoteSteerRequest(input);
      const response=decodeAgentNoteSteerResponse(await invoke("agent_steer_note_turn",{request:structuredClone(request)}));
      if(response.conversationId!==request.conversationId||response.turnId!==request.turnId||response.inputId!==request.inputId)throw new AgentSubmissionDecodeError();
      return response;
    },
    async recover(input){
      const request=decodeAgentNoteSteeringScope(input);
      const response=decodeAgentNoteSteeringRecovery(await invoke("agent_read_note_steering_recovery",{request:structuredClone(request)}));
      if(response.conversationId!==request.conversationId||response.turnId!==request.turnId||response.scope.kind!==request.scope.kind||response.scope.resourceId!==request.scope.resourceId)throw new AgentSubmissionDecodeError();
      return response;
    },
  };
}
