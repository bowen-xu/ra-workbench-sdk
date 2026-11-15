import {
  decodeAgentCatalogPage, decodeAgentConversationActivity, decodeAgentRenameRequest, decodeAgentRenameProof, decodeAgentRenameStatus,
  type AgentCatalogPage, type AgentCatalogRequest, type AgentRenameRequest, type AgentRenameProof, type AgentRenameStatusResponse,
  AgentCatalogDecodeError, type AgentConversationBinding, type AgentConversationActivity,
} from "@research-assistant/core/agent";

export * from "./session";
export * from "./conversationExport";
export * from "./archive";
export * from "./metadata";
export * from "./historyFeed";
export * from "./turn";
export * from "./taskObservation";
export * from "./submission";
export * from "./skillCatalog";
export * from "./steeringRecovery";
export * from "./inputQueue";
export type { AgentQueueEditInspection } from "./queueEditInspection";
export * from "./contextQueue";
export * from "./inputQueueController";
export * from "./inputQueuePreview";

export interface AgentCatalogGateway {
  activity?(request: {readonly binding?: AgentConversationBinding | null}): Promise<readonly AgentConversationActivity[]>;
  /** Lifecycle invalidation only; never carries chat content. */
  subscribeActivity?(changed: () => void): Promise<() => void>;
  list(request: AgentCatalogRequest): Promise<AgentCatalogPage>;
  rename(request: AgentRenameRequest): Promise<AgentRenameProof>;
  /** Read-only inspection, including blocked owners. Missing SQL receipt is not permission to retry. */
  renameStatus(request: AgentRenameRequest): Promise<AgentRenameStatusResponse>;
}
/** Host supplies the native invoke function; this module never imports Tauri. */
export type AgentMetadataInvoke = (command: string, args: Record<string, unknown>, options?: { signal?: AbortSignal }) => Promise<unknown>;
export function createAgentCatalogGateway(invoke: AgentMetadataInvoke): AgentCatalogGateway {
  return {
    async activity(request) { return decodeAgentConversationActivity(await invoke("agent_read_conversation_activity", {request})); },
    async list(request) {
      const page = decodeAgentCatalogPage(await invoke("agent_list_conversations", { request }));
      if (page.conversations.some(row => Boolean(row.internal) !== Boolean(request.internal))) throw new AgentCatalogDecodeError();
      return page;
    },
    async rename(request) {
      const frozen = decodeAgentRenameRequest(request);
      const result = decodeAgentRenameProof(await invoke("agent_rename_conversation", { request: frozen }));
      if (result.conversationId !== frozen.id || result.operationId !== frozen.operationId) throw new AgentCatalogDecodeError();
      return result;
    },
    async renameStatus(request) {
      const frozen = decodeAgentRenameRequest(request);
      const result = decodeAgentRenameStatus(await invoke("agent_read_conversation_rename_status", { request: frozen }));
      if (result.conversationId !== frozen.id || result.operationId !== frozen.operationId) throw new AgentCatalogDecodeError();
      return result;
    },
  };
}

export * from "./queueAdmissions";
export * from "./writingFileDelivery";
export * from "./instructionTrust";
export * from "./workspace";
export * from "./workspaceSuccessor";
export * from "./workspaceReview";
export * from "./proposals";
export * from "./proposalApplications";
export * from "./editorRestorations";
export * from "./undoEditorRestorations";

export * from "./proposalUndos";
export * from "./pendingWritingUndos";
export * from "./pendingWritingApplications";

export * from "./creation";
export * from "./childCreationStatus";
export * from "./compaction";

export * from "./search";
export * from "./fork";
export * from "./deletion";
export * from "./deletionBatch";
export * from "./workspaceDiscard";
export * from "./noteContext";
export * from "./noteSubmission";
export * from "./noteRecovery";
export * from "./noteReview";
export * from "./noteRejection";
export * from "./noteApplication";
export * from "./noteUndo";
export * from "./readingNoteContext";
export * from "./readingNoteSubmission";
export * from "./readingNoteRecovery";
export * from "./noteQueue";
export * from "./noteSteering";
export * from "./steeringController";
export * from "./steeringHandoff";
export * from "./steeringHandoffController";
export * from "./steeringHandoffRegistry";
export * from "./steeringRegistry";
export * from "./inputQueueRegistry";
export * from "./paperContext";
export * from "./paperSubmission";
export * from "./paperPreparationStatus";
export * from "./contextPreparationStatus";
export * from "./contextConfigurationSave";
export * from "./contextConfigurationSeed";
export * from "./contextConfigurationDocumentPort";
export * from "./contextStartStatus";
export * from "./paperStartStatus";
export * from "./paperRecovery";
export * from "./paperMigration";
export * from "./paperQueue";
export * from "./compileResult";
export * from "./subtasks";
export * from "./childSpawn";

export {AgentConversationController} from "./conversationController";
export type {AgentConversationSnapshot} from "./conversationController";
export {ReviewedSubmissionController} from "./reviewedSubmissionController";
export type {SubmissionReviewAdapter, ReviewedSubmissionGateway, ReviewedSubmissionSnapshot} from "./reviewedSubmissionController";
export {ReviewedSubmissionOwnerRegistry} from "./reviewedSubmissionOwner";
export type {ReviewedSubmissionOwnerController} from "./reviewedSubmissionOwner";
