import type {NotePageId} from "@research-assistant/core/notes";

/** Stage only the original legacy-annotation slot, preserving the active
 * document's recovery draft and the existing durable migration order. */
export declare function stageLegacyAnnotationDocument(pageId: NotePageId, baseRevision: number, body: string): void;
/** Uses the existing Core document host's draft protection before trashing. */
export declare function requestLiteratureNoteTrash(pageId: NotePageId): Promise<void>;
