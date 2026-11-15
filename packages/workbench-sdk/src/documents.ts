import type {NoteDocumentGateway, ReadingNoteGateway} from "@research-assistant/data/notes";

export type NoteDocumentAccess = Pick<NoteDocumentGateway,
  "loadDocument" | "saveDocument" | "listRevisions" | "loadRevision" |
  "restoreRevision" | "setRevisionPinned" | "resolveConflict"
> & Pick<ReadingNoteGateway, "getReadingNote">;

/** The trusted plugin's typed document contract. Core returns its existing
 * gateway identity; this Pick does not filter the JavaScript object or grant
 * a runtime permission sandbox. Save/recovery ownership stays with Core. */
export declare function getNoteDocumentGateway(): NoteDocumentAccess;
