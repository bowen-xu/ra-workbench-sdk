import type {LlmModelSelection} from "@research-assistant/core/ai";
import type {
  AgentChildTaskSummary, AgentConversationSummary, AgentEvent, AgentQueueEdit, AgentQueueState,
  AgentResourceScope, AgentTaskKind, AgentUserInput,
} from "@research-assistant/core/agent";
import type {AgentInputQueueState, AgentSubtaskGateway} from "@research-assistant/data/agent";
import type {JSX, MutableRefObject, ReactNode} from "react";
import type {WritingAgentMessage} from "./agentMessages.js";
import type {AgentMessageSearchTarget, ConversationTitleRenameAccess} from "./agentConversations.js";
import type {AgentContextDirectory, AgentContextUsage, AgentModelGateway, AgentResourceGateways} from "./agentContextControls.js";
import type {AgentCommandExecution, AgentCommandGateway, AgentCompactionRecord, AgentComposerDraftAccess} from "./agentSubmission.js";
import type {AgentCanvasMessage} from "./agentUi.js";

export type {AgentMessage, WritingAgentMessage, ChildCreationRecoveryIdentity} from "./agentMessages.js";

export type WritingAgentContextScope = "current-file" | "manuscript";
export type WritingAgentSizePreset = "compact" | "standard" | "comfortable" | "wide" | "maximum";
export interface WritingAgentSubmitOptions {
  readonly userInput?: readonly AgentUserInput[];
  readonly contextScope: WritingAgentContextScope;
  readonly goalMode?: boolean;
  readonly modelSelection?: LlmModelSelection;
  readonly includeConceptRetrieval?: boolean;
}
export type ReadMessageData = (message: WritingAgentMessage, options?: {readonly referencesOnly: true}) => Promise<unknown>;

export interface AgentDomainSessionProps {
  readonly messageRequest?: AgentCanvasMessage | null;
  readonly id: string;
  readonly directory: AgentContextDirectory;
  readonly title: string;
  readonly archived: boolean;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly headerControls: ReactNode;
  readonly onRenamed: (row: AgentConversationSummary) => void;
}

export interface WritingAgentPanelProps {
  readonly approvalConversationId?: string;
  readonly independentContext?: boolean;
  readonly headerControls?: ReactNode;
  readonly showLauncher?: boolean | undefined;
  readonly dismissOnOutsideClick?: boolean | undefined;
  readonly inputDisabled?: boolean;
  readonly suppressPreparing?: boolean;
  readonly isSubmitting?: boolean;
  readonly queuePreparation?: {
    readonly status: "sending" | "recovery";
    readonly onRecover?: () => void;
    readonly recoveryDisabled?: boolean;
  } | undefined;
  readonly hasPendingSubmission?: boolean;
  readonly submittingText?: string;
  readonly turnAttachment?: (turnId: string) => ReactNode;
  readonly turnFeedback?: (turnId: string) => ReactNode;
  readonly turnAttachmentPaths?: (turnId: string) => ReadonlySet<string>;
  readonly readMessageData?: ReadMessageData;
  readonly messageExtras?: (message: WritingAgentMessage) => ReactNode;
  readonly messageActions?: (messageId: string) => ReactNode;
  readonly historyActions?: ReactNode;
  readonly historyHeader?: ReactNode;
  readonly searchTarget?: AgentMessageSearchTarget | null | undefined;
  readonly historyReady?: boolean;
  readonly historyError?: boolean | undefined;
  readonly draft?: string;
  readonly onDraftChange?: (value: string) => void;
  readonly submissionControls?: ReactNode | ((options: WritingAgentSubmitOptions) => ReactNode);
  readonly contextControls?: ReactNode;
  readonly composerAccessory?: ReactNode | ((options: WritingAgentSubmitOptions) => ReactNode);
  readonly draftResources?: AgentComposerDraftAccess;
  readonly resourceScope?: AgentResourceScope;
  readonly onQueue?: (text: string, userInput?: readonly AgentUserInput[]) => void;
  readonly queueDraftEditing?: boolean;
  readonly queueDisabled?: boolean;
  readonly activePath?: string;
  readonly disabledReason?: string;
  readonly contextUsage?: AgentContextUsage;
  readonly modelGateway?: AgentModelGateway;
  readonly resourceGateways?: AgentResourceGateways;
  readonly commandGateway?: AgentCommandGateway;
  readonly commandExecution?: AgentCommandExecution;
  readonly onQueueCommand?: (text: string, originalDraft: string) => void;
  readonly isRunning?: boolean;
  readonly activeTaskKind?: AgentTaskKind | undefined;
  readonly thinkingStartedAtMs?: number;
  readonly conversationTitle?: string;
  readonly conversationRename?: ConversationTitleRenameAccess;
  readonly messages?: readonly WritingAgentMessage[];
  readonly childTasks?: readonly AgentChildTaskSummary[];
  readonly onOpenChildTask?: (conversationId: string) => void;
  readonly onReconcileChildTask?: (conversationId: string) => void;
  readonly onResumeChildTask?: (conversationId: string) => void;
  readonly onCancel?: () => void;
  readonly onCancelSending?: () => void;
  readonly cancelSendingPending?: boolean;
  readonly onSteer?: (text: string, userInput?: readonly AgentUserInput[]) => void;
  readonly steeringPending?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  readonly onModelSelectionChange?: (selection: LlmModelSelection | undefined) => void;
  readonly onSubmit?: (message: string, options: WritingAgentSubmitOptions) => void | false;
  readonly onSubmitCommand?: (command: string, options: WritingAgentSubmitOptions) => void;
  readonly open?: boolean;
  readonly defaultSize?: WritingAgentSizePreset;
}

export interface WritingInputQueueProps {
  readonly state: AgentInputQueueState<AgentQueueState>;
  readonly disabled: boolean;
  readonly compaction?: AgentCompactionRecord | undefined;
  readonly onEdit: (edit: AgentQueueEdit) => Promise<boolean>;
  readonly onEditInComposer?: (input: AgentQueueState["inputs"][number], index: number, queue: AgentQueueState) => Promise<boolean>;
  readonly onReload: () => void | Promise<void>;
  readonly onRetry: () => void;
  readonly onSteer?: (inputId: string, text: string) => Promise<boolean>;
  readonly steerDisabled?: boolean | undefined;
  readonly steerStartsTurn?: boolean;
  readonly preparingStatus?: "none" | "sending" | "sent" | "recovery";
  readonly showPausedLabel?: boolean;
  readonly hiddenInputIds?: readonly string[] | undefined;
}
export type WritingAgentGoalState = "idle" | "running" | "paused";
export interface WritingAgentGoal {
  readonly text: string;
  readonly state: WritingAgentGoalState;
  readonly onDelete?: () => void;
  readonly onToggle?: () => void;
  readonly onEdit?: (text: string) => void;
  readonly statusDescription?: string;
}
export interface WritingAgentTaskStackProps {
  readonly queue?: WritingInputQueueProps;
  readonly goal?: WritingAgentGoal;
}

export interface AgentChangeSummaryItem {
  readonly id: string;
  readonly identity?: string;
  readonly label: string;
  readonly path?: string;
  readonly stats?: {readonly additions: number; readonly deletions: number};
  readonly disabled?: boolean;
  readonly onOpen: () => void;
}
export interface AgentChangeUndo {
  readonly disabled: boolean;
  readonly busy?: boolean;
  readonly hint?: string | undefined;
  readonly title?: string | undefined;
  readonly label?: string;
  readonly run: () => Promise<boolean>;
}

/** Same Core presenters and registration owners; this module declares no runtime. */
export declare function WritingAgentPanel(props: WritingAgentPanelProps): JSX.Element;
export declare function WritingAgentTaskStack(props: WritingAgentTaskStackProps): JSX.Element | null;
export declare function AgentChangeContribution(props: {
  readonly ariaLabel: string;
  readonly ownerIdentity?: string;
  readonly items: readonly AgentChangeSummaryItem[];
  readonly stats?: {readonly additions: number; readonly deletions: number};
  readonly undo?: AgentChangeUndo | undefined;
  readonly children?: ReactNode;
}): JSX.Element;
export declare function AgentTransientFailure(props: {
  readonly id: string;
  readonly content: string;
  readonly retry: () => void;
  readonly diagnosticText?: string;
}): JSX.Element;
export declare function AgentRecoveryMessage(props: {
  readonly id: string;
  readonly label: string;
  readonly content: string;
  readonly diagnosticText?: string | undefined;
  readonly retry?: {readonly label: string; readonly onClick: () => void} | undefined;
  readonly children?: ReactNode;
  readonly embedded?: boolean;
}): JSX.Element;

export interface MessageInspectionRequest {
  readonly conversationId: string;
  readonly turnId: string;
  readonly itemId: string;
  readonly referencesOnly?: boolean;
}
export interface MessageInspectionData extends MessageInspectionRequest {
  readonly schemaVersion: 1;
  readonly events: readonly AgentEvent[];
  readonly frozenSubmission: unknown;
  readonly userInput?: readonly AgentUserInput[];
}
export type ReadMessageInspection = (request: MessageInspectionRequest) => Promise<MessageInspectionData>;
export declare const readMessageInspection: ReadMessageInspection;
export declare function useAgentChildTasks(
  conversationId: string | null | undefined,
  refreshKey?: unknown,
  onError?: (reason: unknown) => void,
  gateway?: Pick<AgentSubtaskGateway, "list" | "subscribe">,
): {
  readonly tasks: readonly AgentChildTaskSummary[];
  readonly reload: () => Promise<readonly AgentChildTaskSummary[]>;
};
export declare function useAgentHostLifecycle(dependencies: readonly unknown[]): MutableRefObject<number>;
export declare function useAgentMountedGuard(): MutableRefObject<boolean>;
