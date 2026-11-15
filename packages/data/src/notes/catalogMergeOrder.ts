import type {NoteIndexItem, NoteIndexQuery} from "@research-assistant/core/notes";
import {NOTE_CATALOG_COLLATION_VERSION, type NoteCatalogRuntime} from "./catalogRuntime";
import {NotesGatewayError} from "./errors";

const bytes = (a: Uint8Array, b: Uint8Array): number => {
  for (let index = 0; index < Math.min(a.length,b.length); index++) if (a[index] !== b[index]) return a[index]! - b[index]!;
  return a.length - b.length;
};
/** Only the heads of two already ordered source pages are compared. This never
 * sorts a corpus or asks for editable bodies. Recent/favorites need no Wasm. */
export async function catalogMergeOrder(query: NoteIndexQuery, loadRuntime: () => Promise<NoteCatalogRuntime>): Promise<(a: NoteIndexItem,b: NoteIndexItem) => number> {
  const sort = query.sort ?? (query.view === "favorites" && !query.search.trim() ? undefined : {field: "updatedAt",direction: "descending"});
  const runtime = sort && sort.field !== "updatedAt" ? await loadRuntime() : undefined;
  if (runtime && runtime.collationVersion !== NOTE_CATALOG_COLLATION_VERSION)
    throw new NotesGatewayError("index_failed","note_catalog_collation_mismatch：统一笔记目录的排序组件版本不匹配。");
  const keys = new Map<NoteIndexItem,Uint8Array>(), identities = new Map<NoteIndexItem,Uint8Array>(), encoder = new TextEncoder();
  const key = (item: NoteIndexItem): Uint8Array => {
    let value = keys.get(item);
    if (!value) {
      const label = sort?.field === "title" ? item.title : sort?.field === "category" ? item.category === "independent" ? "独立笔记" : "附属笔记" : item.owner?.label ?? item.sourceLabel ?? "";
      value = runtime!.sortKey(label); keys.set(item,value);
    }
    return value;
  };
  const identity = (item: NoteIndexItem): Uint8Array => {
    let value = identities.get(item);
    if (!value) {value = encoder.encode(item.id); identities.set(item,value);}
    return value;
  };
  return (a,b) => {
    let difference: number;
    if (!sort) difference = (a.favoritePosition ?? Number.MAX_SAFE_INTEGER) - (b.favoritePosition ?? Number.MAX_SAFE_INTEGER);
    else {
      if (sort.field === "updatedAt") {
        const left = Date.parse(a.updatedAt), right = Date.parse(b.updatedAt);
        if (!Number.isFinite(left) || !Number.isFinite(right)) throw new NotesGatewayError("index_failed","note_catalog_timestamp_invalid：笔记目录包含无效编辑时间。");
        difference = left - right;
      } else difference = bytes(key(a),key(b));
      if (sort.direction === "descending") difference = -difference;
    }
    return difference || bytes(identity(a),identity(b));
  };
}
