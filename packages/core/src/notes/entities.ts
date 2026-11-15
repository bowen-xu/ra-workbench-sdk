const MAX_IDENTIFIER_LENGTH = 128;
export const MAX_NOTE_TITLE_LENGTH = 240;

declare const notePageIdBrand: unique symbol;
declare const noteBlockIdBrand: unique symbol;
declare const noteLinkIdBrand: unique symbol;
declare const noteRevisionIdBrand: unique symbol;

export type NotePageId = string & { readonly [notePageIdBrand]: true };
export type NoteBlockId = string & { readonly [noteBlockIdBrand]: true };
export type NoteLinkId = string & { readonly [noteLinkIdBrand]: true };
export type NoteRevisionId = string & { readonly [noteRevisionIdBrand]: true };

export type NoteLifecycleStatus = "active" | "archived" | "trashed";

export interface NotePage {
  readonly id: NotePageId;
  readonly title: string;
  /** Derived from a page-level paper provenance link, never from the title. */
  readonly literaturePaperId?: string;
  readonly parentPageId?: NotePageId;
  readonly position: number;
  readonly status: NoteLifecycleStatus;
  readonly isFavorite: boolean;
  readonly revision: number;
  readonly schemaVersion: number;
  readonly projectIds: readonly string[];
  readonly tagIds: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly trashedAt?: string;
}

export interface NotePageDraft {
  readonly title: string;
  readonly parentPageId?: NotePageId;
  readonly parentBlockPosition?: number;
}

function assertIdentifier(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > MAX_IDENTIFIER_LENGTH) {
    throw new Error(`${label} 无效`);
  }
  return normalized;
}

export function notePageId(value: string): NotePageId {
  return assertIdentifier(value, "笔记页面 ID") as NotePageId;
}

export function noteBlockId(value: string): NoteBlockId {
  return assertIdentifier(value, "笔记块 ID") as NoteBlockId;
}

export function noteLinkId(value: string): NoteLinkId {
  return assertIdentifier(value, "笔记链接 ID") as NoteLinkId;
}

export function noteRevisionId(value: string): NoteRevisionId {
  return assertIdentifier(value, "笔记版本 ID") as NoteRevisionId;
}

export function normalizeNoteTitle(value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    return "无标题";
  }
  if (normalized.length > MAX_NOTE_TITLE_LENGTH) {
    throw new Error(`笔记标题不能超过 ${MAX_NOTE_TITLE_LENGTH} 个字符`);
  }
  return normalized;
}

export function assertExpectedRevision(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("笔记版本无效");
  }
  return value;
}

export function assertValidNoteTree(
  pages: readonly Pick<NotePage, "id" | "parentPageId">[],
): void {
  const parents = new Map<NotePageId, NotePageId | undefined>();
  for (const page of pages) {
    if (parents.has(page.id)) {
      throw new Error(`重复的笔记页面 ID：${page.id}`);
    }
    parents.set(page.id, page.parentPageId);
  }

  for (const page of pages) {
    const seen = new Set<NotePageId>([page.id]);
    let cursor = page.parentPageId;
    while (cursor !== undefined) {
      if (seen.has(cursor)) {
        throw new Error("笔记页面树不能形成环路");
      }
      seen.add(cursor);
      cursor = parents.get(cursor);
    }
  }
}
