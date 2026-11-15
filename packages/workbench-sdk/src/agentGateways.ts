import type * as Agent from "@research-assistant/data/agent";
import type {AgentApplicationScope} from "@research-assistant/core/agent";

/** Core-selected transports retain their existing admission and recovery owners. */
export declare const agentApplicationGateway: ReturnType<typeof Agent.createAgentApplicationGateway>;
export declare const agentCatalogGateway: Agent.AgentCatalogGateway;
export declare const agentCompactionGateway: ReturnType<typeof Agent.createAgentCompactionGateway>;
export declare const agentCompileResultGateway: ReturnType<typeof Agent.createAgentCompileResultGateway>;
export declare const agentCreationGateway: ReturnType<typeof Agent.createAgentCreationGateway>;
export declare const agentEditorRestorationGateway: ReturnType<typeof Agent.createAgentEditorRestorationGateway>;
export declare const agentInputQueueGateway: ReturnType<typeof Agent.createAgentInputQueueGateway>;
export declare const agentInputQueuePreviewGateway: ReturnType<typeof Agent.createAgentInputQueuePreviewGateway>;
export declare const agentInstructionTrustGateway: ReturnType<typeof Agent.createAgentInstructionTrustGateway>;
export declare const agentMetadataGateway: ReturnType<typeof Agent.createAgentMetadataGateway>;
export declare const agentPendingWritingApplicationGateway: ReturnType<typeof Agent.createAgentPendingWritingApplicationGateway>;
export declare const agentPendingWritingUndoGateway: ReturnType<typeof Agent.createAgentPendingWritingUndoGateway>;
export declare const agentProposalGateway: ReturnType<typeof Agent.createAgentProposalGateway>;
export declare const agentSessionGateway: Agent.AgentSessionGateway;
export declare const agentSteeringGateway: ReturnType<typeof Agent.createAgentSteeringGateway>;
export declare const agentSubmissionGateway: ReturnType<typeof Agent.createAgentSubmissionGateway>;
export declare const agentSubtaskGateway: Agent.AgentSubtaskGateway;
export declare const agentTurnGateway: Agent.AgentTurnGateway;
export declare const agentUndoGateway: ReturnType<typeof Agent.createAgentUndoGateway>;
export declare const agentWorkspaceDiscardGateway: ReturnType<typeof Agent.createAgentWorkspaceDiscardGateway>;
export declare const agentWorkspaceGateway: ReturnType<typeof Agent.createAgentWorkspaceGateway>;
export declare const agentWorkspaceReviewGateway: ReturnType<typeof Agent.createAgentWorkspaceReviewGateway>;
export declare const agentWorkspaceSuccessorGateway: ReturnType<typeof Agent.createAgentWorkspaceSuccessorGateway>;
export declare const agentWritingFileDeliveryGateway: ReturnType<typeof Agent.createAgentWritingFileDeliveryGateway>;

export declare function getAgentUndoEditorRestorationGateway(
  scope: AgentApplicationScope,
): ReturnType<typeof Agent.createAgentUndoEditorRestorationGateway>;
