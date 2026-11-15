import type {ComponentType, ReactNode, Ref} from "react";
import type {ReadingNoteBlock, ReadingNoteSource} from "@research-assistant/core/notes";
import type {ResearchProject} from "@research-assistant/core/project";
import type {WorkspaceClosePort} from "./workbench.js";
import type {PluginConfigurationDeclaration} from "./configuration.js";
import type {RuntimeLiteraturePort} from "./literatureRuntime.js";
import type {AgentDomainSessionProps} from "./agentPresentation.js";
import type {WritingSourceNavigation} from "./sourceNavigation.js";

/** Existing source-workspace inputs, projected by the owning Core/App host.
 * Navigation acknowledgments retain their original operation identities. */
export interface PluginWorkspaceHostProps {
  readonly navigationTabId: string | undefined;
  readonly onNavigateTab: (id: string) => void;
  readonly onSessionsChanged: (ids: readonly string[], active: string) => void;
  readonly tabHost: HTMLElement | null;
  readonly project: ResearchProject | undefined;
  readonly openSource: ReadingNoteSource | undefined;
  readonly onSourceOpened: (opened: boolean) => void;
  readonly openItemId: string | undefined;
  readonly onItemOpened: () => void;
}
export interface PluginWorkspaceRestore {
  readonly homeTabId: string;
  readonly readActiveTabId: () => string;
}
export interface PluginReadingActionsProps {readonly note: ReadingNoteBlock; readonly disabled?: boolean;}
export interface PluginReadingTemplateProps {
  readonly initialResourceId?: string;
  readonly onClose: () => void;
  /** Owner is retained for cleanup; preserve drafts but accept no new input. */
  readonly disabled?: boolean;
}
/** The three existing reading presentation/navigation contributions. They are
 * owned by the same view registration, not a separate global service catalog. */
export interface PluginReadingContributions {
  readonly ReadingActions?: ComponentType<PluginReadingActionsProps>;
  readonly ReadingTemplateDialog?: ComponentType<PluginReadingTemplateProps>;
  readonly requestPortraitDetail?: (id: string) => void;
}
/** Original writing workspace inputs, supplied by the owning App host. */
export interface PluginWritingWorkspaceHostProps {
  readonly sourceNavigation?: WritingSourceNavigation | undefined;
  readonly tabHost?: HTMLElement | null;
  readonly tabsActive?: boolean;
  readonly onOperationBusyChange?: (busy: boolean) => void;
  readonly openManuscriptId: string | undefined;
  readonly onManuscriptOpened: () => void;
  readonly onFocusModeChange?: (focused: boolean) => void;
  readonly onEditorVisibilityChange?: (visible: boolean) => void;
}
/** The private file owner stays inside Runtime; Core receives its local scope
 * and original close preparation after that owner has registered its boundary. */
export interface PluginWritingRuntimeBinding {
  readonly Scope: ComponentType<{readonly children: ReactNode}>;
  readonly prepareClose: () => Promise<boolean>;
}
export interface PluginWritingRuntimeProps {
  readonly onReady: (binding: PluginWritingRuntimeBinding) => () => void;
  readonly isDisabled: () => boolean;
  readonly subscribe: (listener: () => void) => () => void;
}
/** These roles share the view registration and its original file owner. */
export interface PluginWritingContributions {
  readonly Runtime: ComponentType<PluginWritingRuntimeProps>;
  readonly Session: ComponentType<AgentDomainSessionProps>;
}
export interface PluginViewProps {
  readonly active: boolean;
  readonly ref?: Ref<WorkspaceClosePort>;
  readonly workspace?: PluginWorkspaceHostProps;
  readonly writingWorkspace?: PluginWritingWorkspaceHostProps;
}
export interface PluginViewContribution {
  readonly id: string;
  readonly title: string;
  /** Optional display priority. Higher values appear first, default 0.
   * Equal priorities sort by stable view ID. Older hosts may ignore this hint. */
  readonly priority?: number;
  readonly render: (props: PluginViewProps) => ReactNode;
  readonly restore?: PluginWorkspaceRestore;
  readonly reading?: PluginReadingContributions;
  readonly writing?: PluginWritingContributions;
}
/** View registration is owned by the activating instance. Release is
 * idempotent and may reject when Core cannot safely save/close that owner. */
export interface PluginViewRegistration {
  open(): Promise<void>;
  dispose(): Promise<void>;
}
export interface PluginActivationContext {
  readonly pluginId: string;
  readonly apiVersion: 1;
  /** Only the discovered literature instance receives its package-bound port.
   * Older hosts may omit it; unsupported calls must fail without static fallback. */
  readonly literatureRuntime?: RuntimeLiteraturePort;
  readonly registerView: (view: PluginViewContribution) => PluginViewRegistration;
  /** Hooks are awaited; failure does not authorize forced document disposal. */
  readonly onDispose: (dispose: () => void | Promise<void>) => void;
}
export interface RuntimePluginModule {
  /** Pure owner-scoped declarations; Core chooses persistence mappings. */
  readonly configuration?: PluginConfigurationDeclaration;
  activate(context: PluginActivationContext): void | Promise<void>;
  deactivate?(): void | Promise<void>;
}
