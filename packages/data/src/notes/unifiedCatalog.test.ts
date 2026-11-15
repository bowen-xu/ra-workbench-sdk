import {expect,it} from "vitest";
import {filterNoteIndexRecords,orderNoteIndexItems,type NoteIndexQuery,type NoteIndexItem} from "@research-assistant/core/notes";
import {harness,query} from "./unifiedCatalog.fixture";
import {UnifiedNoteCatalog} from "./unifiedCatalog";

it("reads the genuine page catalog without a writing provider and restores the same writing entries when reassembled", async () => {
  const h = harness(40), before = JSON.stringify({pages: h.pages, writing: h.writing});
  const absent = new UnifiedNoteCatalog({queryNotePageCatalog: h.queryPages}, undefined, h.loadRuntime);
  const page = await absent.query(query);
  expect(page.items.every(value => value.target.kind !== "writing")).toBe(true);
  expect(page.revisions).toEqual({pages: 1});
  expect(h.queryWriting).not.toHaveBeenCalled();
  expect(JSON.stringify({pages: h.pages, writing: h.writing})).toBe(before);
  const restored = await h.catalog.query(query);
  expect(restored.items.some(value => value.target.kind === "writing")).toBe(true);
  expect(JSON.stringify({pages: h.pages, writing: h.writing})).toBe(before);
});

it("returns recent twenty from bounded source pages with no optional collation load",async () => {
  const h = harness(2400), result = await h.catalog.query(query);
  expect(result.items).toHaveLength(20); expect(result.nextCursor).toBeTruthy(); expect(result.revisions).toEqual({pages:1,writing:1});
  expect(h.queryPages.mock.calls.map(([q])=>q.limit)).toEqual([20,1]);
  expect(h.queryWriting.mock.calls.map(([q])=>q.limit)).toEqual([20,1]);
  expect(h.loadRuntime).not.toHaveBeenCalled();
  const expected = orderNoteIndexItems(filterNoteIndexRecords([...h.pages,...h.writing].map(item=>({...item,searchText:item.title})),query),query);
  expect(result.items.map(item=>item.id)).toEqual(expected.slice(0,20).map(item=>item.id));
});

it.each([1,2,7,20,50,200])("merges every item exactly once at limit %s, including uneven source tails",async limit => {
  const h = harness(211), q = {...query,limit};
  const expected = orderNoteIndexItems(filterNoteIndexRecords([...h.pages,...h.writing].map(item=>({...item,searchText:item.title})),q),q);
  const found: NoteIndexItem[] = []; let cursor: string | undefined;
  do {const page = await h.catalog.query({...q,...(cursor ? {cursor} : {})}); found.push(...page.items); cursor = page.nextCursor;} while (cursor);
  expect(found).toEqual(expected); expect(new Set(found.map(item=>item.id)).size).toBe(expected.length);
  expect(h.queryPages.mock.calls.every(([q])=>q.limit === limit || q.limit === 1)).toBe(true);
  expect(h.queryWriting.mock.calls.every(([q])=>q.limit === limit || q.limit === 1)).toBe(true);
});

it("retains an entirely unconsumed writing page when ordinary notes win the first page",async () => {
  const h = harness(80); h.pages.splice(0,80,...h.pages.map(item=>({...item,updatedAt:"2026-10-25T00:00:00Z"})));
  let result = await h.catalog.query(query), count = result.items.length;
  expect(result.items.every(item=>item.target.kind !== "writing")).toBe(true);
  while (result.nextCursor && result.items.every(item=>item.target.kind !== "writing")) {result = await h.catalog.query({...query,cursor:result.nextCursor}); count += result.items.length;}
  expect(count).toBeGreaterThan(60); expect(result.items.some(item=>item.target.kind === "writing")).toBe(true);
  expect(h.queryWriting.mock.calls.filter(([q])=>q.limit === 20)).toHaveLength(1);
});

it.each([
  {category:"independent"},{view:"favorites"},{view:"trash"},
] as const)("does not query irrelevant writing resources in %j",async scope => {
  const h = harness(); await h.catalog.query({...query,...scope}); expect(h.queryWriting).not.toHaveBeenCalled(); expect(h.loadRuntime).not.toHaveBeenCalled();
});

it("searches both live sources across category/favorites but performs revision checks without searching bodies again",async () => {
  const h = harness(), result = await h.catalog.query({...query,category:"independent",view:"favorites",search:"Note"});
  expect(result.items.some(item=>item.target.kind === "writing")).toBe(true);
  expect(h.queryPages.mock.calls.map(([q])=>q.search)).toEqual(["Note",""]);
  expect(h.queryWriting.mock.calls.map(([q])=>q.search)).toEqual(["Note",""]);
});

it("returns explicit pending and failure details without reading any document",async () => {
  const h = harness(); const original = h.queryWriting.getMockImplementation()!;
  h.queryWriting.mockImplementation(async q=>({...await original(q),pendingCount:17,errorCount:1,issues:[{manuscriptId:"project",path:"bad.ranote",cause:"writing_note_json_invalid: position 4"}]}));
  const result = await h.catalog.query(query); expect(result).toMatchObject({pendingCount:17,errorCount:1,issues:[{cause:expect.stringContaining("position 4")}]});
});

it("does not mutate cached continuation positions when the same cursor is retried",async () => {
  const h = harness(100), first = await h.catalog.query(query);
  const a = await h.catalog.query({...query,cursor:first.nextCursor!}), b = await h.catalog.query({...query,cursor:first.nextCursor!});
  expect(a.items).toEqual(b.items);
});

it("bounds cursor retention and explicitly expires old positions and wrong query scopes",async () => {
  const h = harness(100), first = await h.catalog.query(query);
  const invalid: Partial<NoteIndexQuery>[] = [{category:"dependent"},{view:"archive"},{search:"Note"},{limit:19},{sort:{field:"title",direction:"ascending"}}];
  for (const changed of invalid) await expect(h.catalog.query({...query,...changed,cursor:first.nextCursor!})).rejects.toThrow("cursor_expired");
  for (let i=0;i<17;i++) await h.catalog.query(query);
  await expect(h.catalog.query({...query,cursor:first.nextCursor!})).rejects.toThrow("cursor_expired");
});

it("does not accept another owner's cursor or keep positions after clear",async () => {
  const h = harness(), first = await h.catalog.query(query), other = harness();
  await expect(other.catalog.query({...query,cursor:first.nextCursor!})).rejects.toThrow("cursor_expired");
  h.catalog.clear(); await expect(h.catalog.query({...query,cursor:first.nextCursor!})).rejects.toThrow("cursor_expired");
});
