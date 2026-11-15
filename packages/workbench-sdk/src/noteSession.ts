import type {Dispatch, JSX, RefObject, SetStateAction} from "react";
import type {AgentNoteApplication, AgentNoteRewriteReview} from "@research-assistant/core/agent";
import type {NoteDocumentV1, NoteLifecycleStatus, NoteLink, NotePageId} from "@research-assistant/core/notes";
import type {NoteDocumentSnapshot, NoteTargetQuery} from "@research-assistant/data/notes";
import type {NoteSaveCoordinator, NoteSaveStatus, NoteOpenFailure} from "./noteDocuments.js";
import type {NoteEditorInstallPort} from "./noteEditor.js";
import type {NoteSourceNavigation} from "./sourceNavigation.js";
import type {ResearchObjectTarget} from "./noteMetadata.js";
import type {WorkspacePresentation} from "./workbench.js";

/** Read-only presentation of an existing Core owner; not a new HBS session. */
export interface RetainedNoteDocument {
  readonly snapshot: NoteDocumentSnapshot;
  readonly editorSessionId: number;
  readonly saveStatus: NoteSaveStatus;
  readonly saveMessage: string | undefined;
}

export type NoteDocumentLoadState = {readonly phase: "idle"}
  | {readonly phase: "loading" | "ready"; readonly pageId: NotePageId; readonly title?: string}
  | {readonly phase: "failed"; readonly pageId: NotePageId; readonly title?: string; readonly failure: NoteOpenFailure};

export interface NoteSessionOptions {
  readonly onError: (message: string) => void;
  readonly onNotice: (message: string) => void;
  readonly onLoaded: (pageId: NotePageId, outgoing: readonly NoteLink[], incoming: readonly NoteLink[]) => void;
}

/** The original save/close operations; implementations and recovery stay in Core. */
export interface NoteDocumentSession {
  readonly snapshot: NoteDocumentSnapshot | undefined;
  readonly setSnapshot: Dispatch<SetStateAction<NoteDocumentSnapshot | undefined>>;
  readonly loadState: NoteDocumentLoadState;
  readonly saveStatus: NoteSaveStatus;
  readonly saveMessage: string | undefined;
  readonly editorSessionId: number;
  readonly saveControllerRef: Readonly<RefObject<NoteSaveCoordinator | undefined>>;
  readonly retainedSessions: readonly RetainedNoteDocument[];
  readonly loadPage: (id: NotePageId, allowRecovery?: boolean, preloaded?: NoteDocumentSnapshot, reload?: boolean, title?: string) => Promise<void>;
  readonly disposeSession: (id?: NotePageId, cancelLoad?: boolean) => void;
  readonly ensureDurable: (requireSaved?: boolean, pageId?: NotePageId) => Promise<boolean>;
  readonly ensureAllDurable: (requireSaved?: boolean) => Promise<boolean>;
  readonly saveExplicitly: () => Promise<"saved" | "preserved">;
  readonly onDocumentChange: (document: NoteDocumentV1) => void;
  readonly onRetainedDocumentChange: (document: NoteDocumentV1, editorSessionId?: number) => void;
  readonly getSnapshot: () => NoteDocumentSnapshot | undefined;
  readonly getSelectedPageId: () => NotePageId | undefined;
  readonly refreshAfterStructure: (id: NotePageId) => Promise<void>;
  readonly deactivate: () => void;
  readonly retain: (ids: readonly string[]) => void;
  readonly updateMetadata: (page: NoteDocumentSnapshot["page"]) => void;
  readonly observePages: (pages: readonly NoteDocumentSnapshot["page"][]) => void;
  readonly rememberLinks: (id: NotePageId, outgoing: readonly NoteLink[], incoming: readonly NoteLink[]) => void;
}

export interface RetainedNoteEditorsProps {
  readonly sessions: readonly RetainedNoteDocument[];
  readonly activeId: string | undefined;
  readonly conflictLocked: boolean;
  readonly isPageDraft?: (id: string) => boolean;
  readonly hasPageTitle?: boolean;
  readonly readingPageIds?: ReadonlySet<string>;
  readonly onChange: (document: NoteDocumentV1, editorSessionId: number) => void;
  readonly onInstallPort?: (port: NoteEditorInstallPort | undefined) => void;
  readonly diffControlsTarget?: HTMLElement | null;
  readonly sourceNavigation?: NoteSourceNavigation | undefined;
  readonly onAssetStatus?: (message: string) => void;
  readonly pageTargets?: readonly {readonly id: string; readonly title: string}[];
  readonly readingTargets?: readonly {readonly id: string; readonly label: string; readonly quote: string}[];
  readonly queryNoteTargets?: NoteTargetQuery | undefined;
  readonly researchTargets?: readonly ResearchObjectTarget[];
}

export type NoteAcceptanceState = {readonly phase: "idle"} | {
  readonly phase: "applying" | "recovery"; readonly pageId: string; readonly message: string;
};
export interface NoteAcceptanceOptions {
  readonly snapshot: NoteDocumentSnapshot | undefined;
  readonly editorSessionId: number;
  readonly saves: Readonly<RefObject<NoteSaveCoordinator | undefined>>;
}
export interface NoteAcceptance {
  readonly state: NoteAcceptanceState;
  readonly registerEditor: (port: NoteEditorInstallPort | undefined) => void;
  readonly accept: (review: AgentNoteRewriteReview) => Promise<void>;
  readonly undo: (review: AgentNoteRewriteReview, application: AgentNoteApplication) => Promise<void>;
  readonly retry: () => Promise<void>;
}

export interface NoteWorkspaceTabsOptions {
  readonly page: {readonly id: NotePageId; readonly title: string; readonly status?: NoteLifecycleStatus} | undefined;
  readonly active: boolean; readonly homeActive?: boolean; readonly enabled: boolean; readonly dirty: boolean;
  readonly transientIds?: readonly string[]; readonly pinnedPageId?: NotePageId; readonly documentPageId?: NotePageId;
  readonly open: (id: NotePageId, background?: boolean) => Promise<void>;
  readonly getPageId: () => NotePageId | undefined;
  readonly prepare: (id?: NotePageId) => Promise<boolean>;
  readonly clear: (preserveHome?: boolean) => void;
  readonly dispose?: (id: NotePageId) => void;
  readonly onHome?: () => void;
  readonly onClose?: ((ids: readonly string[], active?: string, presentation?: WorkspacePresentation) => void) | undefined;
}
export interface NoteWorkspaceTabs {
  readonly pin: (id: string) => void;
  readonly closeDeleted: (ids: readonly string[]) => Promise<void>;
  readonly home: () => Promise<boolean>;
  readonly retainedIds: readonly string[];
}
export interface PreparedNavigationSession {
  dispatch(): void; commit(snapshot: NoteDocumentSnapshot): Promise<void> | void; cancel(): void; recover(): void;
}
export interface NoteSessionApi {
  readonly useNoteDocumentSession: (options: NoteSessionOptions) => NoteDocumentSession;
  readonly RetainedNoteEditors: (props: RetainedNoteEditorsProps) => JSX.Element;
  readonly useNoteAcceptance: (options: NoteAcceptanceOptions) => NoteAcceptance;
  readonly useNoteWorkspaceTabs: (options: NoteWorkspaceTabsOptions) => NoteWorkspaceTabs;
  readonly useNoteHistoryScope: (root: RefObject<HTMLElement | null>, active?: boolean) => void;
  readonly prepareNavigationSessions: (before: NoteDocumentSnapshot, after: NoteDocumentV1) => PreparedNavigationSession | undefined;
  readonly synchronizeNoteReview: (page: string) => Promise<void>;
  readonly holdTextEditor: (page: string, request: string, value: boolean) => void;
  readonly isTextEditorHeld: (page: string) => boolean;
  readonly getNoteReviewSaveState: (page: string) => {readonly pendingChanges?: number; readonly status: NoteSaveStatus; readonly message?: string};
}
