import type {JSX} from "react";
import type {
  AgentContextConversation, AgentContextPrepareRequest, AgentContextPreview, AgentContextReceipt,
  AgentContextResource, AgentContextSelection, AgentContextState, AgentContextQueueEditRequest,
  AgentConversationProjection, AgentModelIdentity, AgentPickerResource, AgentQueueEditScope,
  AgentQueueState, AgentResourceScope, AgentSkillCatalog, AgentSkillIdentity,
  AgentStartResponse, AgentSteerResponse, AgentUserInput, AgentWritingSteerRequest, SystemDocumentGateway,
} from "@research-assistant/core/agent";
import type {
  AgentContextConfigurationSaveGateway, AgentContextConfigurationSeedGateway, AgentContextPrepareProvenGateway,
  AgentContextPrepareStatusGateway, AgentContextQueueGateway, AgentContextStartGateway,
  AgentInputQueueState, AgentQueueEditInspection, AgentSessionGateway, AgentSteeringHandoffGateway,
  AgentSteeringHandoffRegistry, AgentSteeringHandoffState, AgentTaskObservationGateway,
} from "@research-assistant/data/agent";
import type {AiAssistanceGateway} from "./aiAssistance.js";
import type {WritingAgentMessage} from "./agentMessages.js";

export interface AgentContextUsage {
  readonly contextWindowTokens?: number;
  readonly inputTokens: number;
  readonly measurement?: "estimated" | "stale";
}
export type AgentContextUsageReader = (conversationId: string, model: AgentModelIdentity,
  signal: AbortSignal) => Promise<AgentContextUsage | undefined>;
export type AgentModelGateway = Pick<AiAssistanceGateway, "getLlmConfiguration" | "fetchLlmProviderModels">;

export interface AgentSkillCatalogReader {
  list(): Promise<AgentSkillCatalog>;
}
export interface AgentMcpServerSummary {
  readonly serverId: string;
  readonly environmentId: string;
  readonly revision: string;
  readonly enabled: boolean;
  readonly credentialConfigured: boolean;
  readonly approved: boolean;
}
export interface AgentMcpCatalogReader {
  list(): Promise<readonly AgentMcpServerSummary[]>;
}
export interface AgentResourceGateways {
  readonly systemDocuments?: SystemDocumentGateway;
  readonly tools?: AgentMcpCatalogReader;
  readonly skills?: AgentSkillCatalogReader;
  readonly hostResources?: (scope: AgentResourceScope) => Promise<readonly AgentPickerResource[]>;
  readonly openedResources?: readonly AgentPickerResource[];
  readonly refreshOpenedResources?: () => Promise<readonly AgentPickerResource[]>;
  readonly conversationResources?: (query: string) => Promise<readonly AgentPickerResource[]>;
  readonly readSkillDocument?: (identity: AgentSkillIdentity, scope?: AgentResourceScope) => Promise<string>;
}

export interface AgentContextConfiguration {
  readonly revision: number;
  readonly state: AgentContextState;
}
export interface AgentContextDirectory {
  readonly manuscriptId: string;
  readonly title: string;
  readonly path: string;
}
/** The original context gateway consumes only read/set from Core's directory port. */
export interface AgentContextDirectoryGateway {
  read(conversationId: string): Promise<AgentContextDirectory | null>;
  set(conversationId: string, expectedDirectoryId: string | null, directoryId: string | null): Promise<AgentContextDirectory | null>;
}
export type AgentContextSteerRequest = Omit<AgentWritingSteerRequest, "manuscriptId">;
export interface AgentContextGateway {
  readonly steeringOwner?: object;
  readonly directories?: AgentContextDirectoryGateway;
  subscribeConfiguration?(conversationId: string, changed: () => void): Promise<() => void>;
  readConfiguration?(conversationId: string, initializeInternal?: boolean): Promise<AgentContextConfiguration | null>;
  saveConfiguration?(conversationId: string, expectedRevision: number, state: AgentContextState): Promise<AgentContextConfiguration>;
  readonly configurationSave?: AgentContextConfigurationSaveGateway;
  readonly configurationSeed?: AgentContextConfigurationSeedGateway;
  readonly queue?: AgentContextQueueGateway & Partial<AgentQueueEditInspection<AgentContextQueueEditRequest>>;
  readonly preparation?: {readonly proven: AgentContextPrepareProvenGateway; readonly status: AgentContextPrepareStatusGateway};
  readonly guardedStart?: AgentContextStartGateway;
  readonly taskObservation?: AgentTaskObservationGateway;
  readonly steeringHandoff?: AgentSteeringHandoffGateway;
  steer?(request: AgentContextSteerRequest): Promise<AgentSteerResponse>;
  recoverQueue?(conversationId: string): Promise<AgentContextPreview | null>;
  readonly sessions: AgentSessionGateway;
  list(): Promise<readonly AgentContextConversation[]>;
  search(query: string): Promise<readonly AgentContextSelection[]>;
  catalog?(query: string): Promise<readonly AgentContextSelection[]>;
  recommend?(candidate: AgentContextSelection, signal?: AbortSignal): Promise<AgentContextSelection>;
  prepare(request: AgentContextPrepareRequest): Promise<AgentContextPreview>;
  restore(receipt: AgentContextReceipt): Promise<AgentContextPreview>;
  start(preview: AgentContextPreview, options?: {readonly resumeQueue: boolean}): Promise<AgentStartResponse>;
  interrupt(conversationId: string, turnId: string): Promise<void>;
}

export interface AgentContextContribution {
  resources: AgentResourceGateways;
  context: AgentContextState;
  change(next: AgentContextState): Promise<void>;
  ready: boolean;
  loading: boolean;
  saving: boolean;
  recovery: JSX.Element | null;
  flush(): Promise<void>;
  controls: JSX.Element | null;
  selected(input: readonly AgentUserInput[] | undefined, requestId: string): AgentContextResource[];
  accept(requestId: string): Promise<void>;
}
export interface ConversationSteeringHandoff {
  available: boolean;
  state: AgentSteeringHandoffState | null;
  blocked: boolean;
  queueSyncPending: boolean;
  canSubmit(turnId: string): boolean;
  submit(queue: AgentQueueState, turnId: string, inputId: string): Promise<boolean>;
  retry(): Promise<void>;
  refresh(): Promise<void>;
}

/** The original live gateway and hooks retain Core configuration, permission,
 * queue, cancellation and recovery owners. These declarations create no owner. */
export declare const agentContextGateway: AgentContextGateway;
export declare function useAgentContextUsage(projection: AgentConversationProjection | null,
  reader?: AgentContextUsageReader, selectedModel?: Pick<AgentModelIdentity, "providerId" | "modelId">): AgentContextUsage | undefined;
export declare function useContextContribution(id: string | null, disabled: boolean, existing?: AgentResourceGateways,
  _manuscriptId?: string, pending?: boolean, gateway?: AgentContextGateway,
  access?: {readonly readOnly?: boolean}): AgentContextContribution;
export declare function useConversationSteeringHandoff(id: string, gateway: AgentContextGateway,
  registry: AgentSteeringHandoffRegistry | undefined, ready: boolean, projection: AgentConversationProjection | null,
  onSettled: () => void | boolean | Promise<void | boolean>, scope?: AgentQueueEditScope,
  queueReadSequence?: number, isAdmissionDisabled?: () => boolean): ConversationSteeringHandoff;
export declare function useHiddenHandoffQueueInputs(identity: string, conversationId: string,
  handoff: AgentSteeringHandoffState | null, queueState: AgentInputQueueState<AgentQueueState> | null,
  messages: readonly WritingAgentMessage[]): readonly string[];
