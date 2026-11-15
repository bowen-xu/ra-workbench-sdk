import {expect, it} from "vitest";
import {notePageId, noteBlockId, noteLinkId, type NotePage, type NoteReadingSource} from "@research-assistant/core/notes";
import {decodeNoteCatalogCursor, noteCatalogBucket, noteCatalogObjectOrderKey, projectNoteCatalogHeader, projectNoteCatalogItemHeader} from "./catalogProjection";
import type {NoteCatalogRuntime} from "./catalogRuntime";

// These tests cover metadata/cursor boundaries. The actual Rust/Wasm collation
// ABI and IndexedDB binary ordering have separate executable parity regressions.
const runtime: NoteCatalogRuntime = {
  collationVersion: "test", normalizationVersion: "test", fold: text => text.toLowerCase(),
  sortKey: text => new TextEncoder().encode(text), reverseKey: key => Uint8Array.from([...key].flatMap(byte => [254,255-byte]).concat(255)),
  terms: text => text.toLowerCase().split(/\s+/u).filter(Boolean),
  displayTitle: (body,quote,fallback) => (body.trim() || quote.trim() || fallback).split("\n")[0]!,
};
const page: NotePage = {id: notePageId("page"),title: "标题",position: 0,status: "active",isFavorite: true,revision: 17,schemaVersion: 1,projectIds: [],tagIds: [],createdAt: "2026-10-23T00:00:00Z",updatedAt: "2026-10-23T00:00:00Z"};
const source: NoteReadingSource = {id: noteBlockId("source"),pageId: page.id,noteType: "highlight",color: "yellow",source: {
  paperId: "paper",paperTitle: "来源",attachmentId: "attachment",contentSha256: "",pageIndex: 0,rects: [],quoteExact: "摘录",quotePrefix: "",quoteSuffix: "",state: "exact",
}};

it("keeps object cursor order consistent with SQLite UTF-8 identity order", () => {
  const keys = ["😀","\ue000","𐀀"].map(id => {
    const header = projectNoteCatalogHeader({page: {...page,id: notePageId(id)},links: [],bodyFirstLine: "",ordinal: 1},runtime);
    const key = noteCatalogObjectOrderKey(header);
    return {id,bytes: [...key[1]].map(byte => byte.toString(16).padStart(2,"0")).join("")};
  });
  expect(keys.sort((left,right) => left.bytes < right.bytes ? -1 : left.bytes > right.bytes ? 1 : 0).map(value => value.id)).toEqual(["\ue000","𐀀","😀"]);
});

it("orders new source identities by UTF-8 bytes without changing the returned identity", () => {
  const base = projectNoteCatalogHeader({page,links:[],bodyFirstLine:"",ordinal:1},runtime).item;
  const headers = ["😀","\ue000","𐀀"].map((id,index) => projectNoteCatalogItemHeader({item:{...base,id},metadataText:"Metadata",ordinal:index+1},runtime));
  const keys = headers.map(header => ({id:header.item.id,key:header.orderKeys.find(key=>key[0]==="recent/all/title/ascending")![2]}));
  expect(keys.sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0).map(row=>row.id)).toEqual(["\ue000","𐀀","😀"]);
  expect(headers[0]!.item.id).toBe("😀"); expect(headers[0]!.metadataText).toBe("metadata");
});

it("keeps canonical identity and authoring revision independent of query keys", () => {
  const before = structuredClone(page);
  const header = projectNoteCatalogHeader({page,links: [],bodyFirstLine: "正文首行",ordinal: 7,favoritePosition: 2},runtime);
  expect(header.item).toMatchObject({id: "page:page",title: "标题",snippet: "",category: "independent",target: {kind: "page",pageId: page.id},favoritePosition: 2});
  expect(header.item).not.toHaveProperty("revision"); expect(page).toEqual(before);
  expect(header.metadataText).not.toContain("正文首行");
  expect(header.orderKeys).toHaveLength(43); // Display keys plus two favorite orders and one object-ID order.
  expect(header.orderKeys.at(-1)).toEqual(["objects/active",new TextEncoder().encode(page.id),"note_page"]);
});

it("reuses only the short body title for reading metadata, excluding dependent favorites", () => {
  const header = projectNoteCatalogHeader({page,source,links: [],bodyFirstLine: "缓存首行",ordinal: 1},runtime);
  expect(header.item).toMatchObject({title: "缓存首行",category: "dependent",isFavorite: false,owner: {kind: "highlight",id: source.id},target: {kind: "reading",pageId: page.id,noteId: source.id}});
  expect(header.metadataText).toContain("摘录");
  expect(header.metadataText).toContain("来源");
  expect(header.orderKeys.at(-1)).toEqual(["objects/active",new TextEncoder().encode(source.id),"reading_note"]);
  expect(header.orderKeys.some(key => key[0].startsWith("favorites/"))).toBe(false);
  expect(projectNoteCatalogHeader({page,source,links: [],bodyFirstLine: "",ordinal: 1},runtime).item.title).toBe("摘录");
});

it("preserves independent position-note ownership and all lifecycle buckets", () => {
  const position = {...source,noteType: "page_note" as const};
  for (const status of ["active","archived","trashed"] as const) {
    const header = projectNoteCatalogHeader({page: {...page,status},source: position,links: [],bodyFirstLine: "首行",ordinal: 1},runtime);
    expect(header.item.category).toBe("independent");
    expect(header.item.owner).toBeUndefined();
    expect(header.orderKeys.some(key => key[0].startsWith(status === "trashed" ? "search-trash/" : "search-live/"))).toBe(true);
    if (status !== "active") expect(header.orderKeys.some(key => key[0].startsWith("favorites/"))).toBe(false);
  }
});

it("indexes the canonical provenance link when the page row has no legacy paper field", () => {
  const link = {id: noteLinkId("origin"),sourcePageId: page.id,relation: "derived_from" as const,isBroken: false,createdAt: page.createdAt,
    target: {kind: "paper" as const,id: "canonical-paper-id",labelSnapshot: "文献标题"}};
  const header = projectNoteCatalogHeader({page,links: [link],bodyFirstLine: "",ordinal: 1},runtime);
  expect(header.metadataText).toContain("canonical-paper-id");
  expect(header.item.sourceLabel).toBe("文献标题");
});

it("rejects foreign source identities and invalid derived ordinal/timestamp", () => {
  const input = {page,links: [],bodyFirstLine: "",ordinal: 1};
  expect(() => projectNoteCatalogHeader({...input,source: {...source,pageId: notePageId("other")}},runtime)).toThrow(/source_mismatch/u);
  expect(() => projectNoteCatalogHeader({...input,ordinal: 0},runtime)).toThrow(/ordinal_invalid/u);
  expect(() => projectNoteCatalogHeader({...input,page: {...page,updatedAt: "bad"}},runtime)).toThrow(/timestamp_invalid/u);
});

it("scopes cursors to query identity and derived generation", () => {
  const bucket = noteCatalogBucket({category: "all",view: "favorites"});
  expect(bucket).toBe("favorites/all/favorite");
  expect(noteCatalogBucket({category: "dependent",view: "favorites"},true)).toBe("search-live/updatedAt/descending");
  const scope = {generation: 3,bucket,queryHash: ""};
  const value = {schema: 2,...scope,id: "page:page"};
  expect(decodeNoteCatalogCursor(JSON.stringify(value),scope)).toEqual(value);
  expect(() => decodeNoteCatalogCursor(JSON.stringify(value),{...scope,generation: 4})).toThrow(/catalog_changed/u);
  for (const invalid of ["null", "[]", "{}", "\"cursor\"", JSON.stringify({...value,authority: true}), JSON.stringify({...value,bucket: "foreign"}), JSON.stringify({...value,queryHash: "foreign"}), JSON.stringify({...value,schema:1,terms:[]})])
    expect(() => decodeNoteCatalogCursor(invalid,scope)).toThrow(/cursor_invalid/u);
});
