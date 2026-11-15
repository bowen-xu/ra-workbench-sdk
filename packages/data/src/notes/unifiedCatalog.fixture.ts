import {vi} from "vitest";
import {notePageId, noteBlockId, filterNoteIndexRecords, orderNoteIndexItems, type NoteIndexItem, type NoteIndexQuery, type NoteIndexRecord} from "@research-assistant/core/notes";
import {UnifiedNoteCatalog} from "./unifiedCatalog";
import {NOTE_CATALOG_COLLATION_VERSION, type NoteCatalogRuntime} from "./catalogRuntime";
import type {NotePageCatalogPage} from "./catalog";
import type {WritingNoteCatalogPage} from "./writingCatalog";

// Adapter stubs exercise merge ownership only. Real persistent source ordering,
// Wasm parity and record counts have separate browser/native acceptance tests.
export const runtime: NoteCatalogRuntime = {
  collationVersion: NOTE_CATALOG_COLLATION_VERSION,normalizationVersion: "test",
  sortKey: text => new TextEncoder().encode(text),reverseKey: key => key,fold: text => text.toLowerCase(),terms: text => text.split(/\s+/u),displayTitle: (_body,_quote,fallback) => fallback,
};
export function item(index: number, writing = false): NoteIndexItem {
  const id = String(index).padStart(5,"0");
  return {id: writing ? `writing:${JSON.stringify(["project",id])}` : `page:${id}`,title: `Note ${id}`,snippet: "",
    category: writing || index % 3 === 0 ? "dependent" : "independent",
    ...(writing ? {owner: {kind: "manuscript" as const,id: "project",label: "Project"}} : index % 3 === 0 ? {owner: {kind: "highlight" as const,id,label: "Paper"}} : {}),
    updatedAt: new Date(Date.UTC(2026,9,24) + index * 1000).toISOString(),status: index % 11 === 0 ? "archived" : "active",
    isFavorite: !writing && index % 3 !== 0 && index % 2 === 0,
    ...(!writing && index % 3 !== 0 && index % 2 === 0 ? {favoritePosition: 5000 - index} : {}),
    target: writing ? {kind: "writing",manuscriptId: "project",path: `${id}.ranote`} : index % 3 === 0 ? {kind: "reading",pageId: notePageId(id),noteId: noteBlockId(id)} : {kind: "page",pageId: notePageId(id)}};
}
export function harness(count = 25) {
  const pages = Array.from({length: count},(_,index) => item(index * 2)), writing = Array.from({length: count},(_,index) => item(index * 2 + 1,true));
  let pageRevision = 1, writingRevision = 1;
  const select = (values: readonly NoteIndexItem[],query: NoteIndexQuery): NotePageCatalogPage => {
    const records: NoteIndexRecord[] = values.map(value => ({...value,searchText: value.title}));
    const matching = orderNoteIndexItems(filterNoteIndexRecords(records,query),query);
    const start = query.cursor ? Number(query.cursor) : 0, limit = query.limit ?? 20;
    return {items: matching.slice(start,start+limit),revision: 1,...(start + limit < matching.length ? {nextCursor: String(start + limit)} : {})};
  };
  const queryPages = vi.fn(async (query: NoteIndexQuery): Promise<NotePageCatalogPage> => ({...select(pages,query),revision: pageRevision}));
  const queryWriting = vi.fn(async (query: NoteIndexQuery): Promise<WritingNoteCatalogPage> => ({...select(writing,query),revision: writingRevision,pendingCount: 0,errorCount: 0,issues: []}));
  const loadRuntime = vi.fn(async () => runtime);
  const catalog = new UnifiedNoteCatalog({queryNotePageCatalog: queryPages},{queryWritingNoteCatalog: queryWriting},loadRuntime);
  return {catalog,pages,writing,queryPages,queryWriting,loadRuntime,changePages: () => pageRevision++,changeWriting: () => writingRevision++};
}
export const query: NoteIndexQuery = {category: "all",view: "recent",search: "",limit: 20};
