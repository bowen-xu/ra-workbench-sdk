import type { NoteBlockV1, NoteLink, NoteMetadataBatchReceipt, NotePageId, NotePage, NoteMetadataAction, NoteMetadataReplayRequest } from "@research-assistant/core/notes";
import type { NoteDocumentSnapshot, NotesGateway } from "@research-assistant/data/notes";

/** Committed resource invalidation, not a second document snapshot or write owner. */
export type NoteResourceChange =
  | { readonly kind: "all" }
  | { readonly kind: "tags" }
  | { readonly kind: "metadata"; readonly receipt: NoteMetadataBatchReceipt }
  | { readonly kind: "document"; readonly pageId: NotePageId; readonly revision: number };

export interface NotePageSource { readonly pageId: NotePageId; readonly blockId?: string; readonly anchor?: NoteBlockV1 }
export interface NoteHistoryCommand {
  readonly id: string;
  readonly owner?: object;
  readonly undo: () => void | boolean | Promise<void | boolean>;
  readonly redo: () => void | boolean | Promise<void | boolean>;
}

/** Library resource commands used by management; asset storage, raw search-index
 * maintenance and document-conflict machinery remain outside this interface. */
export type NoteResourceGateway = Pick<NotesGateway,
  "pageCatalog" | "listPages" | "listPageMetadata" | "listFavoritePageIds" |
  "reorderFavorites" | "applyMetadataBatch" | "replayMetadataBatch" |
  "createPage" | "updatePage" | "duplicatePage" | "permanentlyDeletePage" |
  "loadDocument" | "saveDocument" | "commitNavigation" | "listRevisions" |
  "loadRevision" | "restoreRevision" | "setRevisionPinned" |
  "listOutgoing" | "listReadingNotes" | "getReadingNote" | "updateReadingNote" |
  "exportNotes" | "cancelNoteExport"
>;

export interface NoteResourceObservation {
  readonly subscribe: (changed: () => void) => () => void;
  readonly getVersion: () => number;
  readonly getChangesSince: (version: number) => readonly NoteResourceChange[];
  readonly notifyChanged: (change?: NoteResourceChange) => void;
}

/** PDF annotations use the existing Core note store without library-wide,
 * asset, document recovery or client-construction access. */
export type NoteAnnotationGateway = Pick<NotesGateway,
  "listReadingNotes" | "getReadingNote" | "createReadingNote" |
  "updateReadingNote" | "setReadingNoteStatus"
>;
export interface NoteAnnotationAccess extends NoteResourceObservation {
  readonly gateway: NoteAnnotationGateway;
}
export interface LiteratureNoteAccess extends NoteResourceObservation {
  readonly list: (paperId: string) => ReturnType<NotesGateway["listLiteratureNotes"]>;
  readonly create: (paperId: string) => Promise<NoteDocumentSnapshot>;
}

export interface NoteResourceAccess extends NoteResourceObservation {
  readonly gateway: NoteResourceGateway;
  readonly links: {
    readonly listOutgoing: (id: NotePageId) => Promise<readonly NoteLink[]>;
    readonly listBacklinks: (kind: NoteLink["target"]["kind"], id: string) => Promise<readonly NoteLink[]>;
    readonly invalidate: (change: NoteResourceChange) => void;
  };
  readonly creation: {
    readonly create: (favorite?: boolean, source?: NotePageSource) => Promise<NoteDocumentSnapshot>;
    readonly isDraft: (id: string) => boolean;
    readonly forgetEmpty: (id: string) => void;
  };
  readonly history: {
    readonly closeGroups: () => void;
    readonly record: (command: NoteHistoryCommand) => void;
    readonly run: (direction: "undo" | "redo", id?: string, target?: Node) => Promise<boolean>;
  };
  readonly mutate: <T>(operation: (gateway: NoteResourceGateway) => Promise<T>) => Promise<T>;
}

export declare function useNoteResources(): NoteResourceAccess;
export declare function useNoteResourceVersion(): number;
export declare function useNoteAnnotations(): NoteAnnotationAccess;
export declare function useLiteratureNotes(): LiteratureNoteAccess;
export declare function commitNoteMetadata(client: NoteResourceAccess, ids: readonly NotePageId[], action: NoteMetadataAction, replay?: NoteMetadataReplayRequest): Promise<{
  readonly receipt: NoteMetadataBatchReceipt; readonly pages: readonly NotePage[]; readonly warnings: readonly string[];
}>;
export declare function applyNotePageStatus(client: NoteResourceAccess, id: NotePageId, status: "active" | "archived" | "trashed"): Promise<NotePage>;
export declare function publishNoteMetadataReceipt(client: NoteResourceAccess, receipt: NoteMetadataBatchReceipt, action: NoteMetadataAction): void;
