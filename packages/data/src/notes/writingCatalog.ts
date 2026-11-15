import type {NoteIndexPage} from "@research-assistant/core/notes";
import type {NotePageCatalogQuery} from "./catalog";
import {decodeCatalogItems} from "./catalogItems";
import {NotesGatewayError} from "./errors";

export interface WritingNoteCatalogIssue {readonly manuscriptId: string; readonly path: string; readonly cause: string}
export interface WritingNoteCatalogPage extends NoteIndexPage {
  readonly revision: number;
  readonly pendingCount: number;
  readonly errorCount: number;
  readonly issues: readonly WritingNoteCatalogIssue[];
}
export interface WritingNoteCatalogPreparation {readonly processedCount: number; readonly pendingCount: number; readonly errorCount: number}
export interface WritingNoteCatalogPreparationOptions {
  readonly retryErrors?: boolean;
  /** Only the visible query's ownership scope; omitted preserves the explicit
   * whole-live-library preparation command, never an implicit list load. */
  readonly scope?: "active" | "archived" | "live";
}
export interface WritingNoteCatalogGateway {
  prepareWritingNoteCatalog(options?: WritingNoteCatalogPreparationOptions): Promise<WritingNoteCatalogPreparation>;
  queryWritingNoteCatalog(query: NotePageCatalogQuery): Promise<WritingNoteCatalogPage>;
}

export function decodeWritingNoteCatalogPage(value: unknown, limit = 20): WritingNoteCatalogPage {
  const fail = (): never => {throw new NotesGatewayError("storage_error", "writing_note_catalog_response_invalid：写作笔记目录返回了无效分页，请保留当前编辑后重试。");};
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const page = value as Record<string, unknown>;
  const count = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;
  if (Object.keys(page).some(key => !["items","revision","nextCursor","pendingCount","errorCount","issues"].includes(key))
    || !count(page.revision) || !count(page.pendingCount) || !count(page.errorCount) || !Array.isArray(page.items)
    || !Number.isInteger(limit) || limit < 1 || limit > 200 || page.items.length > limit || !Array.isArray(page.issues)
    || page.issues.length > Math.min(5,page.errorCount as number) || (page.errorCount as number) > 0 && !page.issues.length
    || page.nextCursor !== undefined && (typeof page.nextCursor !== "string" || !page.nextCursor || page.nextCursor.length > 8192)) return fail();
  const seen = new Set<string>();
  for (const raw of page.issues) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail();
    const issue = raw as Record<string, unknown>;
    if (Object.keys(issue).some(key => !["manuscriptId","path","cause"].includes(key)) || typeof issue.manuscriptId !== "string" || !issue.manuscriptId
      || typeof issue.path !== "string" || !issue.path || typeof issue.cause !== "string" || !issue.cause) return fail();
    const key = JSON.stringify([issue.manuscriptId,issue.path]); if (seen.has(key)) return fail(); seen.add(key);
  }
  return {items: decodeCatalogItems(page.items,"writing",fail), revision: page.revision as number,
    pendingCount: page.pendingCount as number,errorCount: page.errorCount as number,issues: page.issues as readonly WritingNoteCatalogIssue[],
    ...(page.nextCursor === undefined ? {} : {nextCursor: page.nextCursor as string})};
}

export function decodeWritingNoteCatalogPreparation(value: unknown): WritingNoteCatalogPreparation {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new NotesGatewayError("storage_error","writing_note_catalog_preparation_invalid：写作笔记目录准备回执无效。");
  const result = value as Record<string,unknown>;
  if (Object.keys(result).some(key => !["processedCount","pendingCount","errorCount"].includes(key))
    || ![result.processedCount,result.pendingCount,result.errorCount].every(count => Number.isSafeInteger(count) && (count as number) >= 0) || (result.processedCount as number) > 8)
    throw new NotesGatewayError("storage_error","writing_note_catalog_preparation_invalid：写作笔记目录准备回执无效。");
  return result as unknown as WritingNoteCatalogPreparation;
}
