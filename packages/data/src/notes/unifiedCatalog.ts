import type {NoteIndexItem, NoteIndexQuery} from "@research-assistant/core/notes";
import {decodeNotePageCatalogPage, type NotePageCatalogGateway, type NotePageCatalogPage} from "./catalog";
import {catalogMergeOrder} from "./catalogMergeOrder";
import type {NoteCatalogRuntime} from "./catalogRuntime";
import {NotesGatewayError} from "./errors";
import {decodeWritingNoteCatalogPage, type WritingNoteCatalogGateway, type WritingNoteCatalogPage} from "./writingCatalog";

export interface UnifiedNoteCatalogPage {
  readonly items: readonly NoteIndexItem[];
  readonly nextCursor?: string;
  readonly revisions: {readonly pages: number; readonly writing?: number};
  readonly pendingCount: number;
  readonly errorCount: number;
  readonly issues: WritingNoteCatalogPage["issues"];
}
interface SourceBuffer {
  readonly remaining: readonly NoteIndexItem[];
  readonly revision: number;
  readonly nextCursor?: string;
}
interface Position {
  readonly scope: string;
  readonly pages: SourceBuffer;
  readonly writing?: SourceBuffer;
  readonly diagnostics?: Pick<WritingNoteCatalogPage,"pendingCount" | "errorCount" | "issues">;
}
function validate(query: NoteIndexQuery): number {
  const limit = query?.limit ?? 20;
  if (!query || !["all","independent","dependent"].includes(query.category) || !["recent","favorites","archive","trash"].includes(query.view)
    || typeof query.search !== "string" || !Number.isInteger(limit) || limit < 1 || limit > 200
    || query.cursor !== undefined && (typeof query.cursor !== "string" || !query.cursor || query.cursor.length > 256)
    || query.sort !== undefined && (!query.sort || !["title","category","source","updatedAt"].includes(query.sort.field) || !["ascending","descending"].includes(query.sort.direction)))
    throw new NotesGatewayError("invalid_input","note_catalog_query_invalid：统一笔记查询参数无效。");
  return limit;
}
const changed = () => new NotesGatewayError("revision_conflict","note_catalog_changed：笔记目录已更新，请重新查询。");
const expired = () => new NotesGatewayError("revision_conflict","note_catalog_cursor_expired：笔记列表位置已过期，请重新查询。");

/** Data-layer merge of two indexed, metadata-only sources. At most 16 bounded
 * continuation positions survive in this owner's lifetime. Neither this cache
 * nor a cursor represents authoring permission, a saved revision or HBS state. */
export class UnifiedNoteCatalog {
  private readonly positions = new Map<string,Position>();
  private sequence = 0;
  private epoch = 0;
  private readonly identity = crypto.randomUUID();
  constructor(private readonly pages: NotePageCatalogGateway, private readonly writing: Pick<WritingNoteCatalogGateway,"queryWritingNoteCatalog"> | undefined,
    private readonly loadRuntime: () => Promise<NoteCatalogRuntime>) {}

  clear(): void {this.epoch++; this.positions.clear();}

  async query(input: NoteIndexQuery, options: {readonly signal?: AbortSignal} = {}): Promise<UnifiedNoteCatalogPage> {
    const limit = validate(input), query = {...input,limit,...(input.sort ? {sort: {...input.sort}} : {})}, {cursor: _cursor,...base} = query;
    const scope = JSON.stringify([base.category,base.view,base.search,base.sort ? [base.sort.field,base.sort.direction] : null,limit]), signal = options.signal, epoch = this.epoch;
    const check = () => {signal?.throwIfAborted(); if (epoch !== this.epoch) throw expired();};
    check();
    const callPages = async (value: NoteIndexQuery) => {
      check(); const page = decodeNotePageCatalogPage(await this.pages.queryNotePageCatalog(value,options),value.limit); check(); return page;
    };
    const callWriting = async (value: NoteIndexQuery) => {
      if (!this.writing) throw new NotesGatewayError("source_unavailable", "writing_note_catalog_unavailable：写作目录未装配；原资料已保留。");
      check(); const page = decodeWritingNoteCatalogPage(await this.writing.queryWritingNoteCatalog(value),value.limit); check(); return page;
    };
    const buffer = (page: NotePageCatalogPage): SourceBuffer => ({remaining: page.items,revision: page.revision,...(page.nextCursor ? {nextCursor: page.nextCursor} : {})});
    const hasWriting = !!this.writing && query.view !== "trash" && (query.search.trim() !== "" || query.category !== "independent" && query.view !== "favorites");
    let position: Position;
    if (query.cursor) {
      const saved = this.positions.get(query.cursor);
      if (!saved || saved.scope !== scope) throw expired();
      position = saved;
    } else {
      const [pages,writing] = await Promise.all([callPages(base),hasWriting ? callWriting(base) : undefined]);
      position = {scope,pages: buffer(pages),...(writing ? {writing: buffer(writing),diagnostics: {pendingCount: writing.pendingCount,errorCount: writing.errorCount,issues: writing.issues}} : {})};
    }
    // Separate databases cannot share a transaction. Observe a stable revision
    // vector across source reads, and reject changes instead of mixing pages.
    const verify = async () => {
      const checkpoint = {...base,search: "",limit: 1};
      const [pages,writing] = await Promise.all([callPages(checkpoint),position.writing ? callWriting(checkpoint) : undefined]);
      if (pages.revision !== position.pages.revision || writing?.revision !== position.writing?.revision) throw changed();
    };
    if (query.cursor) await verify();
    let pageBuffer = position.pages, writingBuffer = position.writing;
    const items: NoteIndexItem[] = [];
    let refilled = false;
    let compare: Awaited<ReturnType<typeof catalogMergeOrder>> | undefined;
    const fill = async (source: SourceBuffer, kind: "pages" | "writing"): Promise<SourceBuffer> => {
      if (source.remaining.length || !source.nextCursor) return source;
      refilled = true;
      const result = kind === "pages" ? await callPages({...base,cursor: source.nextCursor}) : await callWriting({...base,cursor: source.nextCursor});
      if (result.revision !== source.revision) throw changed();
      if (result.nextCursor && (!result.items.length || result.nextCursor === source.nextCursor)) throw new NotesGatewayError("index_failed","note_catalog_cursor_stalled：笔记来源游标未前进。");
      return buffer(result);
    };
    while (items.length < limit) {
      pageBuffer = await fill(pageBuffer,"pages");
      if (writingBuffer) writingBuffer = await fill(writingBuffer,"writing");
      const page = pageBuffer.remaining[0], writing = writingBuffer?.remaining[0];
      if (!page && !writing) break;
      if (page && writing) compare ??= await catalogMergeOrder(query,this.loadRuntime);
      check();
      if (page && (!writing || compare!(page,writing) <= 0)) {
        items.push(page); pageBuffer = {...pageBuffer,remaining: pageBuffer.remaining.slice(1)};
      } else {
        items.push(writing!); writingBuffer = {...writingBuffer!,remaining: writingBuffer!.remaining.slice(1)};
      }
    }
    if (position.writing && (!query.cursor || refilled)) await verify();
    check();
    const hasMore = pageBuffer.remaining.length || pageBuffer.nextCursor || writingBuffer?.remaining.length || writingBuffer?.nextCursor;
    let nextCursor: string | undefined;
    if (hasMore) {
      nextCursor = `${this.identity}:${++this.sequence}`;
      this.positions.set(nextCursor,{...position,pages: pageBuffer,...(writingBuffer ? {writing: writingBuffer} : {})});
      if (this.positions.size > 16) this.positions.delete(this.positions.keys().next().value!);
    }
    return {items,...(nextCursor ? {nextCursor} : {}),revisions: {pages: position.pages.revision,...(position.writing ? {writing: position.writing.revision} : {})},
      pendingCount: position.diagnostics?.pendingCount ?? 0,errorCount: position.diagnostics?.errorCount ?? 0,issues: position.diagnostics?.issues ?? []};
  }
}
