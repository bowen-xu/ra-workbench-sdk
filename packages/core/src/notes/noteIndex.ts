import type { NoteLifecycleStatus, NotePageId, NoteBlockId } from "./entities";
import type { ReadingNoteBlock } from "./readingNote";

export type NoteCategory = "all" | "independent" | "dependent";
export type NoteIndexView = "recent" | "favorites" | "archive" | "trash";
export type NoteOpenTarget =
  | { readonly kind: "page"; readonly pageId: NotePageId }
  | { readonly kind: "reading"; readonly noteId: NoteBlockId; readonly pageId: NotePageId }
  | { readonly kind: "writing"; readonly manuscriptId: string; readonly path: string };

/** A read projection. The original document remains the only editable body. */
export interface NoteIndexItem {
  readonly id: string;
  readonly title: string;
  readonly snippet: string;
  readonly category: Exclude<NoteCategory, "all">;
  readonly owner?: { readonly kind: "highlight" | "manuscript"; readonly id: string; readonly label: string };
  readonly sourceLabel?: string;
  readonly updatedAt: string;
  readonly status: NoteLifecycleStatus;
  readonly isFavorite: boolean;
  readonly favoritePosition?: number;
  readonly target: NoteOpenTarget;
}
export interface NoteIndexRecord extends NoteIndexItem {
  /** In-memory search projection; never a second persisted document. */
  readonly searchText: string;
}
export type NoteIndexSortField = "title" | "category" | "source" | "updatedAt";
export interface NoteIndexSort { readonly field: NoteIndexSortField; readonly direction: "ascending" | "descending" }
export const DEFAULT_NOTE_INDEX_SORT: NoteIndexSort = { field: "updatedAt", direction: "descending" };

export interface NoteIndexQuery {
  readonly sort?: NoteIndexSort;
  readonly category: NoteCategory;
  readonly view: NoteIndexView;
  readonly search: string;
  readonly cursor?: string;
  readonly limit?: number;
}
export interface NoteIndexPage {
  readonly items: readonly NoteIndexItem[];
  readonly nextCursor?: string;
}

export function isDependentReadingNote(note: Pick<ReadingNoteBlock, "noteType" | "source">): boolean {
  return note.noteType === "highlight" || (note.noteType === "annotation" && note.source.quoteExact.trim() !== "");
}

export function filterNoteIndexRecords(records: readonly NoteIndexRecord[], query: Pick<NoteIndexQuery, "category" | "view" | "search">): readonly NoteIndexRecord[] {
  const terms = query.search.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  return records.filter(item => {
    if (terms.length > 0) return (query.view === "trash" ? item.status === "trashed" : item.status !== "trashed")
      && terms.every(term => item.searchText.toLocaleLowerCase().includes(term));
    const status = query.view === "trash" ? "trashed" : query.view === "archive" ? "archived" : "active";
    return item.status === status && (query.category === "all" || item.category === query.category)
      && (query.view !== "favorites" || item.category === "independent" && item.isFavorite);
  });
}

/** The two UI surfaces share matching records but may require different order. */
export function orderNoteIndexItems(records: readonly NoteIndexRecord[], query: Pick<NoteIndexQuery, "view" | "search" | "sort">): readonly NoteIndexItem[] {
  const matching = [...records].sort((a, b) => {
    if (!query.sort && query.view === "favorites" && query.search.trim() === "")
      return (a.favoritePosition ?? Number.MAX_SAFE_INTEGER) - (b.favoritePosition ?? Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id);
    const sort = query.sort ?? DEFAULT_NOTE_INDEX_SORT;
    const value = (item: NoteIndexItem): string => sort.field === "source" ? item.owner?.label ?? item.sourceLabel ?? "" : sort.field === "category" ? item.category === "independent" ? "独立笔记" : "附属笔记" : item[sort.field];
    const timestamp = (value: string): number => Number.isNaN(Date.parse(value)) ? Number.NEGATIVE_INFINITY : Date.parse(value);
    const difference = sort.field === "updatedAt" ? timestamp(a.updatedAt) - timestamp(b.updatedAt) : value(a).localeCompare(value(b), "zh-CN", {numeric: true, sensitivity: "base"});
    return (sort.direction === "ascending" ? difference : -difference) || a.id.localeCompare(b.id);
  });
  return matching.map(({searchText: _searchText, ...item}) => item);
}

export function selectNoteIndexItems(records: readonly NoteIndexRecord[], query: Pick<NoteIndexQuery, "category" | "view" | "search" | "sort">): readonly NoteIndexItem[] {
  return orderNoteIndexItems(filterNoteIndexRecords(records, query), query);
}

export function queryNoteIndex(records: readonly NoteIndexRecord[], query: NoteIndexQuery): NoteIndexPage {
  const matching = selectNoteIndexItems(records, query);
  const start = query.cursor === undefined ? 0 : matching.findIndex(item => item.id === query.cursor) + 1;
  const limit = Math.min(200, Math.max(1, query.limit ?? 50));
  const items = matching.slice(start, start + limit);
  return { items, ...(start + items.length < matching.length && items.length > 0 ? { nextCursor: items.at(-1)!.id } : {}) };
}

export type NoteDateGroup = "今天" | "昨天" | "近 7 天" | "更早";
export function noteDateGroup(value: string, now: Date): NoteDateGroup {
  const date = new Date(value);
  const calendarDay = (day: Date) => Date.UTC(day.getFullYear(), day.getMonth(), day.getDate()) / 86_400_000;
  const age = calendarDay(now) - calendarDay(date);
  return age <= 0 ? "今天" : age === 1 ? "昨天" : age < 7 ? "近 7 天" : "更早";
}
