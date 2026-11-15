import type {
  AgentInputDraft,
  AgentQueueEdit,
  AgentQueueState,
  AgentReferenceInput,
  AgentUserInput,
} from "@research-assistant/core/agent";

export interface ConversationDraftScope {
  readonly hostKind: "manuscript" | "paper" | "note" | "readingNote";
  readonly hostId: string;
  readonly conversationId: string | null;
}

export interface ConversationDraftAcknowledgmentToken {
  readonly schemaVersion: 1;
  readonly originKey: string;
  readonly revision: string;
  readonly sourceInputId?: string;
  readonly sourceQueueRevision?: string;
}

export interface QueueDraftPlacement {
  readonly input: AgentQueueState["inputs"][number];
  readonly index: number;
  readonly preceding: readonly string[];
  readonly following: readonly string[];
}

export interface ConversationInputDraft extends AgentInputDraft {
  readonly queuePlacement?: QueueDraftPlacement;
}

/** The original Core instance owns draft content, provenance and persistence. */
export interface ConversationDraftStore {
  error(): string;
  read(key: string): string;
  readStructured(key: string): ConversationInputDraft;
  input(key: string, text: string): readonly AgentUserInput[];
  flush(): Promise<void>;
  retryPersistence(): Promise<void>;
  captureAcknowledgmentToken(key: string, text: string): ConversationDraftAcknowledgmentToken | null;
  consumeAcknowledgment(value: ConversationDraftAcknowledgmentToken,
    acceptedScope: ConversationDraftScope): Promise<"cleared" | "preserved">;
  captureAcknowledgment(key: string, text: string): () => void;
  adoptPending(scope: Omit<ConversationDraftScope, "conversationId">, conversationId: string): void;
  forgetConversation(id: string): void;
  update(key: string, next: string | ((current: string) => string)): void;
  updateStructured(key: string, value: AgentInputDraft, placement?: QueueDraftPlacement | null): void;
  restoreQueue(key: string, placement: QueueDraftPlacement): void;
  subscribe(key: string, listener: () => void): () => void;
}

export interface ConversationDraftResources {
  subscribe(listener: () => void): () => void;
  error(): string;
  draft(): ConversationInputDraft;
  set(value: AgentInputDraft): void;
  input(text: string): readonly AgentUserInput[];
  acknowledgmentToken(text: string): ConversationDraftAcknowledgmentToken | null;
  insert(reference: AgentReferenceInput, start?: number, end?: number): void;
  restore(text: string, input?: readonly AgentUserInput[]): void;
  restoreQueue(input: AgentQueueState["inputs"][number], index: number, queue: AgentQueueState): void;
}

export declare function useAgentDraftStore(): ConversationDraftStore;
export declare function useConversationDraft(store: ConversationDraftStore,
  scope: ConversationDraftScope | null, observeText?: boolean): readonly [
    string,
    (next: string | ((current: string) => string)) => void,
    (text: string) => () => void,
    ConversationDraftResources,
  ];
export declare function decodeConversationDraftAcknowledgmentToken(value: unknown): ConversationDraftAcknowledgmentToken;
export declare function queueDraftEdit(draft: ConversationInputDraft, queue: AgentQueueState,
  text: string, userInput: readonly AgentUserInput[], newId?: () => string): AgentQueueEdit;
