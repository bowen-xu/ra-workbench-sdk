import type {JSX, KeyboardEventHandler, ReactNode, Ref, RefObject} from "react";
import type {AgentContextSelection} from "@research-assistant/core/agent";
import type {NoteDocumentV1, NoteLink, NotePage, NotePageId, ReadingNoteBlock} from "@research-assistant/core/notes";
import type {NoteDocumentSnapshot, NoteRevisionSummary, NoteTargetQuery} from "@research-assistant/data/notes";
import type {NoteOpenFailure, NoteSaveStatus} from "./noteDocuments.js";
import type {NoteEditorInstallPort} from "./noteEditor.js";
import type {ResearchObjectTarget} from "./noteMetadata.js";
import type {NoteSourceNavigation} from "./sourceNavigation.js";
import type {WorkspaceClosePort, WorkspacePresentation} from "./workbench.js";

/** Core's single-document host. Management does not acquire its storage/session owner. */
export interface CoreNoteWorkspaceProps {
  readonly initialPageId?: NotePageId;
  readonly initialSnapshot?: NoteDocumentSnapshot | undefined;
  readonly openRequestKey?: number;
  readonly readingSource?: ReadingNoteBlock;
  readonly embedded?: boolean;
  readonly compactHeader?: boolean;
  readonly active?: boolean;
  readonly sourceNavigation?: NoteSourceNavigation | undefined;
  readonly pinnedPageId?: NotePageId;
  readonly onHome?: () => void;
  readonly onNavigatePage?: (id: NotePageId) => void;
  readonly onClosePage?: (ids: readonly string[], active?: string, presentation?: WorkspacePresentation) => void;
  readonly ref?: Ref<WorkspaceClosePort>;
}

/** A stable main-document owner around interchangeable management/fallback UI.
 * Embedded reading-note windows retain an independent Core scope. */
export interface CoreNoteWorkspaceHostProps extends CoreNoteWorkspaceProps {
  readonly children?: ReactNode;
}

export interface NoteDocumentViewProps {
  readonly lifecycleBusy?: boolean;
  readonly onRestore?: () => void;
  readonly onPermanentlyDelete?: () => void;
  readonly compactHeader?: boolean;
  readonly retainEditor?: boolean;
  readonly onDiffControlsTarget?: (node: HTMLDivElement | null) => void;
  readonly sourceNavigation?: NoteSourceNavigation | undefined;
  readonly readingSource?: ReadingNoteBlock;
  readonly onReadingColorChange?: (color: string) => void;
  readonly snapshot: NoteDocumentSnapshot;
  readonly editorSessionId: number;
  readonly pages: readonly NotePage[];
  readonly queryNoteTargets?: NoteTargetQuery;
  readonly onReadPageMetadata?: (ids: readonly NotePageId[]) => Promise<readonly NotePage[]>;
  readonly readingNotes: readonly ReadingNoteBlock[];
  readonly researchTargets: readonly ResearchObjectTarget[];
  readonly saveStatus: NoteSaveStatus;
  readonly saveMessage: string | undefined;
  readonly outgoingLinks: readonly NoteLink[];
  readonly backlinks: readonly NoteLink[];
  readonly showHistory: boolean;
  readonly revisions: readonly NoteRevisionSummary[];
  readonly onOpenPage: (id: NotePageId) => void;
  readonly onOpenReading: (id: ReadingNoteBlock["id"]) => void;
  readonly onDocumentChange: (document: NoteDocumentV1) => void;
  readonly onInstallPort: (port: NoteEditorInstallPort | undefined) => void;
  readonly onAssetStatus: (message: string) => void;
  readonly onUpdatePage: (changes: {readonly title?: string; readonly isFavorite?: boolean; readonly projectIds?: readonly string[]; readonly tagIds?: readonly string[]}) => void;
  readonly onOpenHistory: () => void;
  readonly onCloseHistory: () => void;
  readonly onDuplicate: () => void;
  readonly onArchive: () => void;
  readonly onTrash: () => void;
  readonly onRetrySave: () => void;
  readonly onLoadRevision: (id: NoteRevisionSummary["id"]) => Promise<NoteDocumentV1>;
  readonly onRestoreRevision: (id: NoteRevisionSummary["id"]) => Promise<void>;
  readonly onToggleRevisionPinned: (revision: NoteRevisionSummary) => void;
}

export interface NoteDocumentPendingProps {
  readonly title: string | undefined;
  readonly pageId: string;
  readonly failure: NoteOpenFailure | undefined;
  readonly onRetry: () => void;
  readonly onHome?: () => void;
}

export interface PageLinkBlockProps {
  readonly onKeyDown?: KeyboardEventHandler<HTMLButtonElement>;
  readonly navigationLabel?: string;
  readonly appearance?: "reference" | "plain";
  readonly targetId?: string;
  readonly title: string;
  readonly onOpen: () => void;
  readonly onPin?: () => void;
  readonly disabled?: boolean;
  readonly unavailable?: boolean;
}

export interface NotesShortcutOptions {
  readonly scopeRef?: RefObject<HTMLElement | null>;
  readonly searchInputRef: RefObject<HTMLInputElement | null>;
  readonly onSave: () => void;
  readonly onCreatePage: () => void;
  readonly onSearch?: () => void;
}

/** Named production components and actions, supplied by the existing Core runtime. */
export interface NotePresentationApi {
  readonly CoreNoteWorkspace: (props: CoreNoteWorkspaceProps) => JSX.Element;
  readonly NoteDocumentView: (props: NoteDocumentViewProps) => JSX.Element;
  readonly NoteDocumentPending: (props: NoteDocumentPendingProps) => JSX.Element;
  readonly PageLinkBlock: (props: PageLinkBlockProps) => JSX.Element;
  readonly useNotesShortcuts: (options: NotesShortcutOptions) => void;
  readonly useNoteLifecycleNotice: (page: NotePage | undefined, visible: boolean) => void;
  readonly noteContextCandidate: (page: NotePage, reading: ReadingNoteBlock | undefined, links: readonly NoteLink[]) => AgentContextSelection;
  /** Waits for an existing floating host to durably release the same page. */
  readonly requestReadingNotePanelTransfer: (pageId: NotePageId) => Promise<boolean>;
  readonly reportNoteCreationError: (reason: unknown) => void;
  readonly clearNoteRecoveryDraft: (pageId: NotePageId) => void;
}

/** Signature-only exports. The workbench provides these production values. */
export declare const CoreNoteWorkspace: NotePresentationApi["CoreNoteWorkspace"];
export declare function CoreNoteWorkspaceHost(props: CoreNoteWorkspaceHostProps): JSX.Element;
export declare function useCoreNoteWorkspaceHost(): CoreNoteWorkspaceProps | undefined;
export declare const NoteDocumentView: NotePresentationApi["NoteDocumentView"];
export declare const NoteDocumentPending: NotePresentationApi["NoteDocumentPending"];
export declare const PageLinkBlock: NotePresentationApi["PageLinkBlock"];
export declare const useNotesShortcuts: NotePresentationApi["useNotesShortcuts"];
export declare const useNoteLifecycleNotice: NotePresentationApi["useNoteLifecycleNotice"];
export declare const noteContextCandidate: NotePresentationApi["noteContextCandidate"];
export declare const requestReadingNotePanelTransfer: NotePresentationApi["requestReadingNotePanelTransfer"];
export declare const reportNoteCreationError: NotePresentationApi["reportNoteCreationError"];
export declare const clearNoteRecoveryDraft: NotePresentationApi["clearNoteRecoveryDraft"];
