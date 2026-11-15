import type {NoteCategory, NoteIndexPage, NoteIndexView, NoteIndexSort} from "@research-assistant/core/notes";
import {NotesGatewayError} from "./errors";
import {decodeCatalogItems} from "./catalogItems";

/** Canonical page/reading browse/search provider. Writing files are a separate source
 * of the unified catalog; this contract never returns editable bodies. */
export interface NotePageCatalogQuery {
  readonly category: NoteCategory;
  readonly view: NoteIndexView;
  readonly limit?: number;
  readonly cursor?: string;
  readonly search?: string;
  readonly sort?: NoteIndexSort;
}
export interface NotePageCatalogPage extends NoteIndexPage {
  readonly revision: number;
}
export interface NotePageCatalogGateway {
  /** Cancel queued derived preparation and stale results. An adapter may finish
   * an already-dispatched atomic transaction or native IPC before stopping. */
  queryNotePageCatalog(query: NotePageCatalogQuery, options?: {readonly signal?: AbortSignal}): Promise<NotePageCatalogPage>;
}

/** IPC is untrusted input. Do not let an accidental full document projection
 * enter the list cache, or reinterpret a writing target as a canonical page. */
export function decodeNotePageCatalogPage(value: unknown, limit = 20): NotePageCatalogPage {
  const fail = (): never => {throw new NotesGatewayError("storage_error", "note_catalog_response_invalid：笔记目录返回了无效分页，请保留当前编辑后重试。");};
  const object = (entry: unknown): Record<string, unknown> => entry !== null && typeof entry === "object" && !Array.isArray(entry) ? entry as Record<string, unknown> : fail();
  const text = (entry: unknown) => typeof entry === "string" && entry.length > 0;
  const page = object(value);
  if (Object.keys(page).some(key => !["items","revision","nextCursor"].includes(key))
    || !Number.isSafeInteger(page.revision) || (page.revision as number) < 0 || !Array.isArray(page.items)
    || !Number.isInteger(limit) || limit < 1 || limit > 200 || page.items.length > limit
    || page.nextCursor !== undefined && (!text(page.nextCursor) || (page.nextCursor as string).length > 8192)) fail();
  const items = decodeCatalogItems(page.items as unknown[], "pages", fail);
  return {items,revision:page.revision as number,
    ...(page.nextCursor === undefined ? {} : {nextCursor:page.nextCursor as string})};
}
