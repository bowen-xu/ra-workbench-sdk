import type { NoteDocumentV1 } from "./document";
import type { NotePage, NotePageId } from "./entities";
import type { NoteLink } from "./links";
import type { ReadingNoteBlock } from "./readingNote";

export const NOTE_EXPORT_SCHEMA_VERSION = 1 as const;

export interface NoteExportManifestV1 {
  readonly schemaVersion: typeof NOTE_EXPORT_SCHEMA_VERSION;
  readonly exportedAt: string;
  readonly pages: readonly Pick<NotePage, "id" | "title" | "parentPageId">[];
  readonly readingNotes: readonly ReadingNoteBlock[];
  readonly links: readonly NoteLink[];
  readonly assets: readonly { readonly id: string; readonly relativePath: string; readonly mimeType: string }[];
}

export interface NoteExportPage {
  readonly pageId: NotePageId;
  readonly relativePath: string;
  readonly markdown: string;
  readonly document: NoteDocumentV1;
}

export interface NoteExportBundle {
  readonly manifest: NoteExportManifestV1;
  readonly pages: readonly NoteExportPage[];
}

