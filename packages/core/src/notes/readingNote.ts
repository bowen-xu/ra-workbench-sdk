import type { SourceRect } from "../literature";
import type { SourceSelectorV2 } from "../reader/model";
import type { NoteBlockId, NoteLifecycleStatus, NotePageId } from "./entities";

export type ReadingNoteType = "highlight" | "annotation" | "page_note";
export type ReadingNoteSourceState = "exact" | "page_only" | "needs_relocation" | "paper_in_trash" | "unavailable";

export interface ReadingNoteSource {
  readonly anchorId?: string;
  readonly paperId: string;
  readonly paperTitle: string;
  readonly attachmentId: string;
  readonly contentSha256: string;
  readonly pageIndex: number;
  readonly pageLabel?: string;
  readonly rects: readonly SourceRect[];
  readonly quoteExact: string;
  readonly quotePrefix: string;
  readonly quoteSuffix: string;
  readonly state: ReadingNoteSourceState;
  readonly selector?: SourceSelectorV2;
}

export interface ReadingNoteBlock {
  readonly id: NoteBlockId;
  /** Canonical document owner. Absent only in frozen pre-migration history. */
  readonly pageId?: NotePageId;
  readonly noteType: ReadingNoteType;
  /** Read-only plain-text projection of the ordinary note document. */
  readonly body: string;
  readonly color: string;
  readonly status: NoteLifecycleStatus;
  readonly isFavorite: boolean;
  readonly revision: number;
  readonly source: ReadingNoteSource;
  readonly projectIds: readonly string[];
  readonly tagIds: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly trashedAt?: string;
}

/** Source metadata contains no second copy of the document or page properties. */
export interface NoteReadingSource {
  readonly id: NoteBlockId;
  readonly pageId: NotePageId;
  readonly noteType: ReadingNoteType;
  readonly color: string;
  readonly source: ReadingNoteSource;
}

export interface ReadingNoteDraft {
  readonly id?: NoteBlockId;
  /** Reuses a previously validated source anchor instead of creating a duplicate locator. */
  readonly sourceAnchorId?: string;
  readonly noteType: ReadingNoteType;
  readonly body: string;
  readonly color?: string;
  readonly itemId: string;
  readonly attachmentId: string;
  readonly pageIndex: number;
  readonly pageLabel?: string;
  readonly rects: readonly SourceRect[];
  readonly quoteExact: string;
  readonly quotePrefix?: string;
  readonly quoteSuffix?: string;
  readonly selector?: SourceSelectorV2;
}

export function inferReadingNoteType(annotationType: "highlight" | "note", quoteExact: string): ReadingNoteType {
  if (annotationType === "highlight") return "highlight";
  return quoteExact.trim().length > 0 ? "annotation" : "page_note";
}

export function isPositionReadingNote(note: ReadingNoteBlock): boolean {
  return note.noteType === "annotation" && note.source.quoteExact === "" && note.source.rects.length === 1;
}

export function readingNoteDisplayTitle(note: Pick<ReadingNoteBlock, "body" | "source">, fallback: string): string {
  const title = (note.body.split(/\r?\n/u).find(line => line.trim())?.trim()
    || note.source.quoteExact.split(/\r?\n/u).find(line => line.trim())?.trim() || fallback).slice(0, 100);
  // A shortened display label must still round-trip through UTF-8 resource IPC.
  return title.replace(/[\uD800-\uDBFF]$/u, "");
}

export function readingNoteSourceAt(source: ReadingNoteSource, position: SourceRect): ReadingNoteSource {
  return { ...source, rects: [position], ...(source.selector ? { selector: { ...source.selector,
    segments: source.selector.segments.map(segment => segment.pageIndex === source.pageIndex ? { ...segment, rects: [position] } : segment) } } : {}) };
}
