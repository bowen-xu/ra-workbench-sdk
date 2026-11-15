import type {JSX, ReactNode} from "react";
import type {
  AgentConversationBinding, AgentConversationProjection, AgentConversationSummary, AgentSearchHit,
  AgentCreateBoundRequest, AgentCreateBoundProof, AgentCreateBoundStatus,
} from "@research-assistant/core/agent";
import type {
  AgentSessionGateway, AgentArchiveGateway, AgentCatalogGateway, AgentMetadataGateway, AgentSearchGateway,
  AgentDeletionGateway, AgentDeletionBatchGateway, AgentConversationExportGateway,
  AgentForkGateway, AgentForkOriginGateway, AgentCreationGateway, AgentConversationSnapshot,
} from "@research-assistant/data/agent";
import type {WritingAgentMessage} from "./agentMessages.js";

export {AgentConversationController} from "@research-assistant/data/agent";
export type {AgentConversationSnapshot} from "@research-assistant/data/agent";
export type ConversationForkLock = ConversationOperationLock;

export interface AgentConversationAccess {
    readonly identity: string;
    readonly gateway: AgentSessionGateway;
}

export interface AgentConversationView extends AgentConversationSnapshot {
    readonly reconnect: () => void;
}

export interface BoundConversationListProps {
    readonly binding: AgentConversationBinding | null;
    readonly onCreate?: () => void;
    readonly selectedId: string | null;
    /** Host-owned local draft identity; absent from the list until persisted on first send. */
    readonly pendingConversationId?: string | null;
    readonly onSelect: (id: string, archived?: boolean, hit?: AgentSearchHit, pending?: boolean) => void;
    readonly onArchiveChange?: (id: string, archived: boolean) => void;
    readonly onRefreshSelected?: () => void;
    readonly refreshToken?: number;
    readonly revealConversation?: AgentConversationSummary | null;
    readonly archives?: AgentArchiveGateway;
    readonly catalog?: AgentCatalogGateway;
    readonly metadata?: AgentMetadataGateway;
    readonly search?: AgentSearchGateway;
    readonly deletions?: AgentDeletionGateway;
    readonly batchDeletions?: AgentDeletionBatchGateway;
    readonly exports?: AgentConversationExportGateway;
    readonly deletionConfirmationPreferences?: ConversationDeleteConfirmationPreferences;
    readonly forceDeletionConfirmationPreferences?: ConversationDeleteConfirmationPreferences;
    readonly deletionRecoveryStorage?: Storage;
    readonly deletionRecoveryLock?: ConversationOperationLock;
    readonly onDeleted?: (id: string) => void;
}

export interface ConversationForkActionsOptions {
    readonly parentId: string | null;
    readonly binding: AgentConversationBinding | null;
    readonly projection: AgentConversationProjection | null;
    readonly disabled: boolean;
    readonly onOpen?: ((conversation: AgentConversationSummary) => void) | undefined;
    readonly additionalActions?: ReactNode;
    readonly gateway?: AgentForkGateway;
    readonly metadata?: Pick<AgentMetadataGateway, "read">;
    readonly lock?: ConversationForkLock;
}

export interface ConversationForkOriginProps {
    readonly conversationId: string;
    readonly binding: AgentConversationBinding;
    readonly onOpen: (parent: AgentConversationSummary, throughTurnId: string) => void;
    readonly gateway?: AgentForkOriginGateway;
}

export interface ConversationCreationPorts {
    readonly creation: AgentCreationGateway;
    readonly metadata: Pick<AgentMetadataGateway, "read">;
}

export interface ConversationCreationSnapshot {
    readonly phase: "idle" | "saving" | "unknown" | "checking" | "notCommitted" | "committing" | "committed" | "reading" | "readError" | "ready" | "rejected";
    readonly intent: AgentCreateBoundRequest | null;
    readonly proof: AgentCreateBoundProof | null;
    readonly status: AgentCreateBoundStatus | null;
    readonly current: AgentConversationSummary | null;
    readonly cause: unknown;
    readonly localIssue: unknown;
    readonly adopted: boolean;
}

export interface ConversationRenamePorts {
    readonly catalog: Pick<AgentCatalogGateway, "rename" | "renameStatus">;
    readonly metadata: Pick<AgentMetadataGateway, "read">;
}

export interface ConversationOperationLock {
    run<T>(name: string, operation: () => Promise<T>): Promise<T>;
}

/** Confirmation preferences belong to the host; previews use an isolated memory adapter. */
export interface ConversationDeleteConfirmationPreferences {
    readonly shouldSkip: () => boolean;
    readonly setSkipToday: (skip: boolean) => void;
}

export type AgentMessageSearchTarget = {
    readonly requestId: number;
} & ({
    readonly messageId: string;
    readonly turnId?: never;
} | {
    readonly turnId: string;
    readonly messageId?: never;
});

export interface ConversationTitleRenameAccess {
    readonly conversationId: string;
    readonly catalog: Pick<AgentCatalogGateway, "rename" | "renameStatus">;
    readonly metadata?: Pick<AgentMetadataGateway, "read">;
    readonly onRenamed?: (conversation: AgentConversationSummary) => void;
    readonly onConflict?: () => void;
}

export type BoundCreationStage = "pending" | "unknown" | "committed";

export interface BoundConversationCreationAccess {
  state: ConversationCreationSnapshot | null;
  getSnapshot(): ConversationCreationSnapshot | null;
  submit(id?: string): Promise<AgentConversationSummary | null>;
  check(): Promise<void | null>;
  retryOriginal(): Promise<AgentConversationSummary | null>;
  readCurrent(): Promise<AgentConversationSummary | null>;
  consumeAdoption(adopt: () => boolean): boolean;
  clearAdopted(): boolean;
  finishKnown(): boolean;
}

export interface ConversationMetadataAccess {
  status: string;
  conversation: AgentConversationSummary | null;
  refresh(): Promise<void>;
  unavailableReason: string | undefined;
}

export type ConversationCreationRecoveryProps = Pick<BoundConversationCreationAccess,
  "state" | "check" | "retryOriginal" | "readCurrent" | "finishKnown" | "clearAdopted"> & {
  readonly captureAdoption: () => (conversation: AgentConversationSummary | null) => void;
  readonly onFinished?: () => void;
};

export declare function BoundConversationList(props: BoundConversationListProps): JSX.Element;
export declare function useAgentConversation(id: string | null,
  activation?: object | null, access?: AgentConversationAccess): AgentConversationView;
export declare function useConversationMetadata(id: string | null, binding: AgentConversationBinding | null,
  gateway?: AgentMetadataGateway): ConversationMetadataAccess;
export declare function projectConversationMessages(projection: AgentConversationProjection | null): readonly WritingAgentMessage[];
export declare function clearAgentSessionSelection(binding: AgentConversationBinding, conversationId?: string): void;
export declare function readAgentSessionSelection(binding: AgentConversationBinding): string | null;
export declare function writeAgentSessionSelection(binding: AgentConversationBinding, conversationId: string): void;
export declare function pendingBoundConversationId(binding: AgentConversationBinding, storage?: Storage): string | null;
export declare function readBoundCreation(binding: AgentConversationBinding,
  storage?: Storage): {intent: AgentCreateBoundRequest; stage: BoundCreationStage} | null;
export declare function reserveBoundConversation(binding: AgentConversationBinding, id?: string, storage?: Storage): string;
export declare function conversationCreationMessage(cause: unknown): string;
export declare function ConversationCreationRecovery(props: ConversationCreationRecoveryProps): JSX.Element | null;
export declare function nameInitialConversation(id: string, sourceRequestId: string, text: string,
  ports: ConversationRenamePorts, storage?: Storage): Promise<AgentConversationSummary | null>;
export declare function useConversationForkActions(options: ConversationForkActionsOptions): {
  readonly messageActions: (messageId: string) => ReactNode;
  readonly historyActions: ReactNode;
};
export declare function ConversationForkOrigin(props: ConversationForkOriginProps): JSX.Element | null;
export declare function useBoundConversationCreation(binding: AgentConversationBinding | null,
  ports: ConversationCreationPorts): BoundConversationCreationAccess;
