import type {NoteDocumentV1} from "@research-assistant/core/notes";
import type { NoteDocumentSnapshot } from "@research-assistant/data/notes";
import type {JSX, ReactNode, Ref} from "react";

/** A single native change over a clean editor baseline. The host retains its
 * request identity and reconciles unknown outcomes before releasing this lease. */
export interface NoteExternalSaveLease {
  /** Call immediately before dispatch. A dispatched request cannot be cancelled
   * locally: destroying a view does not roll back the native transaction. */
  markDispatched(): boolean;
  /** Install through the current editor's synchronous history-preserving port.
   * False leaves the lease held; no snapshot/revision is adopted. */
  commit(snapshot: NoteDocumentSnapshot, installEditor: () => undefined): boolean;
  /** A native group receipt may include metadata and structure revision increments. */
  commitGroup(snapshot: NoteDocumentSnapshot, appliedRevision: number, installEditor: () => undefined): boolean;
  /** Only valid before dispatch; permits normal editing again. */
  cancelBeforeDispatch(): boolean;
  /** Only after a definitive transactional rejection proving no write occurred. */
  rejectDispatched?(): boolean;
  requireRecovery(): void;
}

export type NoteSaveStatus = "saved" | "dirty" | "saving" | "failed" | "conflict";

/** The existing Core-owned save admission contract, without a controller class.
 * A view hands the same owner back to Core components; it does not replace it. */
export interface NoteSaveCoordinator {
  enqueue(document: NoteDocumentV1): void;
  flush(): Promise<void>;
  updateRevision(revision: number): void;
  restore(document: NoteDocumentV1, state: "dirty" | "conflict"): void;
  hasUnsavedChanges(): boolean;
  hasExternalChange(): boolean;
  retry(): Promise<void>;
  dispose(): void;
  beginExternalChange(expectedRevision: number, baseline: NoteDocumentV1): NoteExternalSaveLease | null;
  synchronizeExternal?(snapshot: NoteDocumentSnapshot, baseline?: NoteDocumentV1): Promise<void>;
  ensurePreserved?(): Promise<void>;
  isEditingBlocked?(): boolean;
  requiresRequestRetry?(): boolean;
}

export interface NoteOpenFailure {
  readonly kind: "missing" | "failed";
  readonly code: string;
  readonly message: string;
}

// Runtime exports are supplied by Core's same-origin ESM façade. These are
// declarations only: the SDK contains no editor, save session or storage copy.
export type {NotePageSource} from "./noteResources.js";
export type {NoteMetadataChanged} from "./noteMetadata.js";
export declare const NOTE_METADATA_CHANGED: "research-assistant:note-metadata-changed";
export declare const NOTE_PAGES_DELETED: "research-assistant:note-pages-deleted";
export {CoreNoteWorkspace, CoreNoteWorkspaceHost, useCoreNoteWorkspaceHost, NoteDocumentView, NoteDocumentPending, PageLinkBlock,
  useNotesShortcuts, useNoteLifecycleNotice, noteContextCandidate, requestReadingNotePanelTransfer,
  reportNoteCreationError, clearNoteRecoveryDraft} from "./notePresentation.js";
export {useNoteDocumentMetadata, useNoteCatalogTargets, useResearchObjectTargets} from "./noteMetadata.js";
export declare const useNoteDocumentSession: import("./noteSession.js").NoteSessionApi["useNoteDocumentSession"];
export declare const RetainedNoteEditors: import("./noteSession.js").NoteSessionApi["RetainedNoteEditors"];
export declare const useNoteAcceptance: import("./noteSession.js").NoteSessionApi["useNoteAcceptance"];
export declare const useNoteWorkspaceTabs: import("./noteSession.js").NoteSessionApi["useNoteWorkspaceTabs"];
export declare const useNoteHistoryScope: import("./noteSession.js").NoteSessionApi["useNoteHistoryScope"];
export declare const prepareNavigationSessions: import("./noteSession.js").NoteSessionApi["prepareNavigationSessions"];
export declare const synchronizeNoteReview: import("./noteSession.js").NoteSessionApi["synchronizeNoteReview"];
export declare const holdTextEditor: import("./noteSession.js").NoteSessionApi["holdTextEditor"];
export declare const isTextEditorHeld: import("./noteSession.js").NoteSessionApi["isTextEditorHeld"];
export declare const getNoteReviewSaveState: import("./noteSession.js").NoteSessionApi["getNoteReviewSaveState"];
export declare function NotePageToolbar(props: {
  readonly lifecycleActions?: ReactNode;
  readonly pageId?: string;
  readonly disabled?: boolean;
  readonly onRetrySave?: () => void;
  readonly saveStatus: NoteSaveStatus;
  readonly saveMessage: string | undefined;
  readonly favorite: boolean;
  readonly canFavorite?: boolean;
  readonly onFavoriteChange: (favorite: boolean) => void;
  readonly propertiesId?: string;
  readonly showProperties?: boolean;
  readonly onToggleProperties?: () => void;
  readonly moreButtonRef?: Ref<HTMLButtonElement>;
  readonly children: ReactNode;
}): JSX.Element;
export type NoteDocumentTabTarget = {readonly kind: "page"; readonly pageId: string}
  | {readonly kind: "writing"; readonly manuscriptId: string; readonly path: string};
export declare function openNoteDocumentTab(target: NoteDocumentTabTarget, onOpened?: () => void): Promise<void>;
