import type {NotePageId} from "@research-assistant/core/notes";
import type {NoteDocumentSnapshot} from "@research-assistant/data/notes";

/** Metadata-only identities from the existing Core browser-note store. */
export declare function listBrowserNotePageIds(): Promise<readonly NotePageId[]>;
/** Reuses Core's stable target-derived creation intent and original writer. */
export declare function ensureBrowserAnnotationNote(target: readonly [string, string], title: string): Promise<NoteDocumentSnapshot>;
