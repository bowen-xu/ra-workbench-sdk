import {decodeAgentPaperSubmissionPrepareRequest, decodeAgentPaperPrepareStatusResponse, decodeAgentDeletionWriteOptions, sameAgentPaperPrepareRequest,
  type AgentPaperSubmissionPrepareRequest, type AgentPaperPrepareStatusResponse} from "@research-assistant/core/agent";
import type {AgentMetadataInvoke} from "./index";

export interface AgentPaperPrepareStatusGateway {
  read(request: AgentPaperSubmissionPrepareRequest, options?: {readonly expectedEpoch: string}): Promise<AgentPaperPrepareStatusResponse>;
}
export interface AgentPaperPrepareProvenGateway {
  prepare(request: AgentPaperSubmissionPrepareRequest, options?: {readonly expectedEpoch: string}): Promise<Extract<AgentPaperPrepareStatusResponse["status"], {type: "committed"}>>;
}
/** The write returns the proof from the same transaction, without a later read. */
export function createAgentPaperPrepareProvenGateway(invoke: AgentMetadataInvoke): AgentPaperPrepareProvenGateway {
  return {async prepare(request, options) {
    const intent = decodeAgentPaperSubmissionPrepareRequest(request);
    const guard = options === undefined ? undefined : decodeAgentDeletionWriteOptions(options);
    const response = decodeAgentPaperPrepareStatusResponse(await invoke("agent_prepare_paper_submission_proven", {
      request: {...intent, model: intent.model ?? null},
      ...(guard ?? {}),
    }));
    if (!sameAgentPaperPrepareRequest(intent, response.intent) || response.status.type !== "committed"
      || guard && response.status.proof.epoch !== guard.expectedEpoch) throw new Error("Mismatched paper preparation proof");
    return response.status;
  }};
}
export function createAgentPaperPrepareStatusGateway(invoke: AgentMetadataInvoke): AgentPaperPrepareStatusGateway {
  return {async read(request, options) {
    const intent = decodeAgentPaperSubmissionPrepareRequest(request);
    const guard = options === undefined ? undefined : decodeAgentDeletionWriteOptions(options);
    const response = decodeAgentPaperPrepareStatusResponse(await invoke("agent_read_paper_submission_prepare_status", {
      request: {...intent, model: intent.model ?? null},
      ...(guard ?? {}),
    }));
    const epoch = response.status.type === "committed" ? response.status.proof.epoch : response.status.detail.epoch;
    if (!sameAgentPaperPrepareRequest(intent, response.intent) || guard && epoch !== null && epoch !== guard.expectedEpoch)
      throw new Error("Mismatched paper preparation intent");
    return response;
  }};
}
