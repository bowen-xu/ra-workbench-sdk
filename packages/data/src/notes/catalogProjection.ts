import type {NoteIndexItem, NoteIndexQuery, NoteLink, NotePage, NoteReadingSource} from "@research-assistant/core/notes";
import {isDependentReadingNote} from "@research-assistant/core/notes";
import {NotesGatewayError} from "./errors";
import type {NoteCatalogRuntime} from "./catalogRuntime";

/** Short persisted metadata only: the body search projection is a separate row. */
export interface NoteCatalogHeader {
  readonly item: NoteIndexItem;
  readonly bodyFirstLine: string;
  readonly metadataText: string;
  readonly ordinal: number;
  /** Single multiEntry index: [bucket, binary value, stable identity]. */
  readonly orderKeys: readonly (readonly [string, Uint8Array, string])[];
}

/** Persistent object-ID ordering for the existing page/reading search port.
 * UTF-8 identity order matches SQLite, independent of display collation. */
export function noteCatalogObjectOrderKey(header: Pick<NoteCatalogHeader,"item">): readonly [string,Uint8Array,string] {
  const target = header.item.target;
  if (target.kind !== "page" && target.kind !== "reading") throw new NotesGatewayError("index_failed", "note_catalog_object_target_invalid：笔记对象目录目标无效。");
  const id = target.kind === "reading" ? target.noteId : target.pageId;
  return [`objects/${header.item.status}`,new TextEncoder().encode(id),target.kind === "reading" ? "reading_note" : "note_page"];
}

function timestampKey(value: string): Uint8Array {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new NotesGatewayError("invalid_input", "note_catalog_timestamp_invalid：笔记编辑时间无效。");
  // Valid ECMAScript dates fit exactly in the safe integer range. Offset into
  // unsigned 64-bit space, then big endian for native/IndexedDB lexical order.
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(timestamp) + (1n << 63n));
  return bytes;
}

function numericKey(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0) throw new NotesGatewayError("invalid_input", "note_catalog_position_invalid：收藏顺序无效。");
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(value));
  return bytes;
}

export function noteCatalogBucket(query: Pick<NoteIndexQuery, "category" | "view" | "sort">, search = false): string {
  const scope = search ? query.view === "trash" ? "search-trash" : "search-live"
    : `${query.view}/${query.category}`;
  const sort = query.sort ?? (query.view === "favorites" && !search ? undefined : {field: "updatedAt", direction: "descending"});
  return `${scope}/${sort ? `${sort.field}/${sort.direction}` : "favorite"}`;
}

function orderKeys(item: NoteIndexItem, runtime: NoteCatalogRuntime, identity = item.id): NoteCatalogHeader["orderKeys"] {
  const values = {
    updatedAt: timestampKey(item.updatedAt),
    title: runtime.sortKey(item.title),
    category: runtime.sortKey(item.category === "independent" ? "独立笔记" : "附属笔记"),
    source: runtime.sortKey(item.owner?.label ?? item.sourceLabel ?? ""),
  };
  const view = item.status === "active" ? "recent" : item.status === "archived" ? "archive" : "trash";
  const scopes = [`${view}/all`, `${view}/${item.category}`, item.status === "trashed" ? "search-trash" : "search-live"];
  if (item.status === "active" && item.isFavorite && item.category === "independent") scopes.push("favorites/all", "favorites/independent");
  const result: [string, Uint8Array, string][] = [];
  for (const [field, key] of Object.entries(values)) for (const direction of ["ascending", "descending"] as const) {
    const ordered = direction === "ascending" ? key : runtime.reverseKey(key);
    for (const scope of scopes) result.push([`${scope}/${field}/${direction}`, ordered, identity]);
  }
  if (scopes.includes("favorites/all")) for (const scope of ["favorites/all", "favorites/independent"])
    result.push([`${scope}/favorite`, numericKey(item.favoritePosition ?? Number.MAX_SAFE_INTEGER), identity]);
  return result;
}

export const NOTE_CATALOG_UTF8_ORDER_VERSION = "utf8-identity-v1";
/** New sources use an ASCII representation of UTF-8 identity bytes for the
 * final tie, matching SQLite TEXT order even for supplementary characters.
 * Existing page projections keep their deployed format until an explicit
 * derived-index upgrade; the identity returned to callers is never rewritten. */
export function projectNoteCatalogItemHeader(input: {readonly item: NoteIndexItem; readonly metadataText: string; readonly ordinal: number}, runtime: NoteCatalogRuntime): NoteCatalogHeader {
  if (!Number.isInteger(input.ordinal) || input.ordinal < 1 || input.ordinal > 0x7fff_ffff)
    throw new NotesGatewayError("index_failed", "note_catalog_ordinal_invalid：笔记搜索投影标识无效，请重建派生索引。");
  const identity = [...new TextEncoder().encode(input.item.id)].map(byte => byte.toString(16).padStart(2,"0")).join("");
  return {item: input.item, bodyFirstLine: "", metadataText: runtime.fold(input.metadataText), ordinal: input.ordinal, orderKeys: orderKeys(input.item,runtime,identity)};
}

/** Called only for the affected page. A metadata-only update supplies the cached
 * first line; it neither reads nor decodes the saved body search projection. */
export function projectNoteCatalogHeader(input: {
  readonly page: NotePage;
  readonly source?: NoteReadingSource;
  readonly links: readonly NoteLink[];
  readonly bodyFirstLine: string;
  readonly favoritePosition?: number;
  readonly ordinal: number;
}, runtime: NoteCatalogRuntime): NoteCatalogHeader {
  const {page, source} = input;
  if (!Number.isInteger(input.ordinal) || input.ordinal < 1 || input.ordinal > 0x7fff_ffff)
    throw new NotesGatewayError("index_failed", "note_catalog_ordinal_invalid：笔记搜索投影标识无效，请重建派生索引。");
  if (source && source.pageId !== page.id) throw new NotesGatewayError("invalid_input", "note_catalog_source_mismatch：笔记来源与页面不一致。");
  const dependent = source !== undefined && isDependentReadingNote(source);
  const labels = input.links.filter(link => link.sourcePageId === page.id && (link.target.kind === "paper" || link.target.kind === "manuscript"))
    .map(link => link.target.labelSnapshot).filter(Boolean);
  const sourceLabel = labels.join(" · ");
  const title = source ? runtime.displayTitle(input.bodyFirstLine, source.source.quoteExact, page.title) : page.title;
  const item: NoteIndexItem = {
    id: `page:${page.id}`, title, snippet: "", category: dependent ? "dependent" : "independent",
    ...(dependent ? {owner: {kind: "highlight", id: source!.id, label: source!.source.paperTitle}} : {}),
    ...(sourceLabel ? {sourceLabel} : {}), updatedAt: page.updatedAt, status: page.status,
    isFavorite: !dependent && page.isFavorite,
    ...(input.favoritePosition === undefined ? {} : {favoritePosition: input.favoritePosition}),
    target: source ? {kind: "reading",pageId: page.id,noteId: source.id} : {kind: "page",pageId: page.id},
  };
  const provenance = input.links.find(link => link.sourcePageId === page.id && link.sourceBlockId === undefined && link.relation === "derived_from" && link.target.kind === "paper");
  const metadataText = runtime.fold([title, sourceLabel, source?.source.quoteExact, source?.source.paperTitle, provenance?.target.id ?? page.literaturePaperId].filter(Boolean).join(" "));
  return {item, bodyFirstLine: input.bodyFirstLine, metadataText, ordinal: input.ordinal, orderKeys: [...orderKeys(item, runtime),noteCatalogObjectOrderKey({item})]};
}

export interface NoteCatalogCursor {
  readonly schema: 2;
  readonly generation: number;
  readonly bucket: string;
  readonly queryHash: string;
  readonly id: string;
}

/** Cursor identity and derived generation are scoped independently of authoring
 * revisions. A stale list must refresh; it must not authorize a stale write. */
export function decodeNoteCatalogCursor(raw: string | undefined, scope: Omit<NoteCatalogCursor, "schema" | "id">): NoteCatalogCursor | undefined {
  if (raw === undefined) return;
  const invalid = (): never => { throw new NotesGatewayError("invalid_input", "note_catalog_cursor_invalid：笔记目录游标无效。"); };
  if (new TextEncoder().encode(raw).length > 8192) return invalid();
  let value: NoteCatalogCursor;
  try { value = JSON.parse(raw); } catch { return invalid(); }
  if (!value || typeof value !== "object" || Object.keys(value).some(key => !["schema","generation","bucket","queryHash","id"].includes(key))
    || value.schema !== 2 || !Number.isSafeInteger(value.generation) || value.generation < 0 || typeof value.id !== "string" || !value.id
    || value.bucket !== scope.bucket || typeof value.queryHash !== "string" || value.queryHash !== scope.queryHash) return invalid();
  if (value.generation !== scope.generation) throw new NotesGatewayError("revision_conflict", "note_catalog_changed：笔记目录已更新，请重新查询。", scope.generation);
  return value;
}
