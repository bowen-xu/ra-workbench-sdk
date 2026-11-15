import { expect, it } from "vitest";
import { notePageId } from "./entities";
import { filterNoteIndexRecords, orderNoteIndexItems, isDependentReadingNote, noteDateGroup, queryNoteIndex, type NoteIndexRecord } from "./noteIndex";
import {readingNoteDisplayTitle, type ReadingNoteSource} from "./readingNote";

function record(id: string, changes: Partial<NoteIndexRecord> = {}): NoteIndexRecord {
  return { id, title: id, snippet: "", category: "independent", updatedAt: "2026-10-22T10:00:00Z", status: "active",
    isFavorite: false, target: { kind: "page", pageId: notePageId(id) }, searchText: "共同关键词", ...changes };
}
it("shares matching records while retaining distinct favorite and library sort semantics", () => {
  const records = [record("old", {isFavorite: true, favoritePosition: 0, updatedAt: "2020-01-01"}), record("new", {isFavorite: true, favoritePosition: 1})];
  const matching = filterNoteIndexRecords(records, {category: "all", view: "favorites", search: ""});
  expect(orderNoteIndexItems(matching, {view: "favorites", search: ""}).map(item => item.id)).toEqual(["old", "new"]);
  expect(orderNoteIndexItems(matching, {view: "favorites", search: "", sort: {field: "updatedAt", direction: "descending"}}).map(item => item.id)).toEqual(["new", "old"]);
  expect(matching).toEqual(records);
});
it("uses actual reading text, then source quote, then the stored title for candidates", () => {
  expect(readingNoteDisplayTitle({body: "\n 主体标题\n正文", source: {quoteExact: "引用"} as ReadingNoteSource}, "旧标题")).toBe("主体标题");
  expect(readingNoteDisplayTitle({body: "\n", source: {quoteExact: " 引用标题 "} as ReadingNoteSource}, "旧标题")).toBe("引用标题");
  expect(readingNoteDisplayTitle({body: "", source: {quoteExact: ""} as ReadingNoteSource}, "旧标题")).toBe("旧标题");
});
it("classifies highlights and quoted annotations by ownership, leaving unquoted sticky notes independent", () => {
  const source = (quoteExact: string) => ({ quoteExact }) as ReadingNoteSource;
  expect(isDependentReadingNote({ noteType: "highlight", source: source("") })).toBe(true);
  expect(isDependentReadingNote({ noteType: "annotation", source: source("quote") })).toBe(true);
  expect(isDependentReadingNote({ noteType: "annotation", source: source("") })).toBe(false);
  expect(isDependentReadingNote({ noteType: "page_note", source: source("") })).toBe(false);
});
it("orders all ages and origins together, breaking equal edit times by stable identity", () => {
  const records = [record("z"), record("old", { updatedAt: "2020-01-01" }), record("a", { category: "dependent" })];
  expect(queryNoteIndex(records, { category: "all", view: "recent", search: "" }).items.map(x => x.id)).toEqual(["a", "z", "old"]);
});
it("never includes a legacy attached favorite and filters independent notes by ownership rather than source", () => {
  const records = [record("linked", { isFavorite: true, sourceLabel: "某篇文献" }), record("attached", { category: "dependent", isFavorite: true })];
  expect(queryNoteIndex(records, { category: "all", view: "favorites", search: "" }).items.map(x => x.id)).toEqual(["linked"]);
  expect(queryNoteIndex(records, { category: "independent", view: "recent", search: "" }).items.map(x => x.id)).toEqual(["linked"]);
});
it("searches globally across the selected category and favorites, including archive but excluding trash", () => {
  const records = [record("normal"), record("attached", { category: "dependent" }), record("archive", { status: "archived" }), record("trash", { status: "trashed" })];
  expect(queryNoteIndex(records, { category: "dependent", view: "favorites", search: "关键词" }).items).toHaveLength(3);
  expect(queryNoteIndex(records, { category: "independent", view: "trash", search: "关键词" }).items.map(x => x.id)).toEqual(["trash"]);
});
it("paginates without dropping equal-time entries", () => {
  const records = Array.from({ length: 127 }, (_, i) => record(String(i).padStart(3, "0")));
  const ids: string[] = []; let cursor: string | undefined;
  do {
    const page = queryNoteIndex(records, { category: "all", view: "recent", search: "", limit: 50, ...(cursor ? { cursor } : {}) });
    ids.push(...page.items.map(x => x.id)); cursor = page.nextCursor;
  } while (cursor);
  expect(ids).toHaveLength(127); expect(new Set(ids).size).toBe(127);
});
it("groups by local calendar days, including month boundaries and midnight", () => {
  const now = new Date(2026, 10, 1, 0, 1);
  expect(noteDateGroup(new Date(2026, 10, 1).toISOString(), now)).toBe("今天");
  expect(noteDateGroup(new Date(2026, 9, 31, 23, 59).toISOString(), now)).toBe("昨天");
  expect(noteDateGroup(new Date(2026, 9, 26).toISOString(), now)).toBe("近 7 天");
  expect(noteDateGroup(new Date(2026, 9, 25).toISOString(), now)).toBe("更早");
  expect(noteDateGroup(new Date(2026, 9, 31).toISOString(), new Date(2026, 9, 31, 23, 59))).toBe("今天");
});

it("sorts the complete matching set before pagination with stable identities and natural titles", () => {
  const records = Array.from({length: 127}, (_, i) => record(String(i), {title: `笔记 ${127 - i}`, updatedAt: new Date(Date.UTC(2026, 9, 22) - i * 1000).toISOString()}));
  const query = {category: "all" as const, view: "recent" as const, search: "", sort: {field: "title" as const, direction: "ascending" as const}, limit: 50};
  const first = queryNoteIndex(records, query);
  expect(first.items[0]!.title).toBe("笔记 1"); expect(first.items.at(-1)!.title).toBe("笔记 50");
  const second = queryNoteIndex(records, {...query, cursor: first.nextCursor!});
  expect(second.items[0]!.title).toBe("笔记 51");
  expect(queryNoteIndex(records, {...query, sort: {field: "updatedAt", direction: "ascending"}}).items[0]!.id).toBe("126");
  const ties = [record("z", {title: "同名"}), record("a", {title: "同名"})];
  expect(queryNoteIndex(ties, query).items.map(item => item.id)).toEqual(["a", "z"]);
});
