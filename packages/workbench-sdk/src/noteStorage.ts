import type {NoteCatalogRuntime, NotesGateway} from "@research-assistant/data/notes";

/** Same Core store and file adapters; this is not a new storage instance. */
export type NoteLibraryTransferStorage = Pick<NotesGateway,
  "exportNotes" | "cancelNoteExport" | "listPages" | "listReadingNotes" |
  "getReadingNote" | "loadDocument" | "listOutgoing"
>;

/** Core owns the lazy shared Wasm loader and its version checks. */
export declare function loadBrowserNoteCatalogRuntime(): Promise<NoteCatalogRuntime>;
