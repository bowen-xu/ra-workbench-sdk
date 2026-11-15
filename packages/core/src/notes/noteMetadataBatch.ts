import type { NotePage, NotePageId } from "./entities";
import type {PageEntryRemoval} from "./pageEntryHistory";

export interface NoteMetadataHistory {
  readonly statuses:readonly {readonly id:NotePageId;readonly status:NotePage["status"]}[];
  readonly entries:readonly {readonly pageId:NotePageId;readonly saved:readonly PageEntryRemoval[];readonly baseline:readonly PageEntryRemoval[]}[];
}
export interface NoteMetadataReplayRequest {
  readonly operationId:string;
  readonly sourceOperationId:string;
  readonly direction:"undo"|"redo";
  readonly items:NoteMetadataBatchRequest["items"];
}

export type NoteMetadataAction = "trash" | "restore" | "archive" | "favorite" | "unfavorite";
export interface NoteMetadataBatchRequest {
  readonly operationId: string;
  readonly action: NoteMetadataAction;
  readonly items: readonly {readonly id: NotePageId; readonly expectedRevision: number}[];
}
export interface NoteMetadataBatchFailure {
  readonly id: NotePageId; readonly code: string; readonly message: string; readonly currentRevision?: number;
}
export interface NoteMetadataBatchReceipt {
  readonly operationId: string;
  readonly succeededIds: readonly NotePageId[];
  readonly failures: readonly NoteMetadataBatchFailure[];
  readonly pages: readonly NotePage[];
  readonly bodyChangedIds: readonly NotePageId[];
  readonly favoritePageIds: readonly NotePageId[];
  readonly history?:NoteMetadataHistory;
}

/** Plan metadata only. Overlapping ownership groups succeed or fail together. */
export function planNoteMetadataBatch(pages: readonly NotePage[], dependent: ReadonlySet<NotePageId>, request: NoteMetadataBatchRequest, timestamp: string, cascadeOwnership=true) {
  if (!request.operationId || request.operationId.length > 128 || !["trash", "restore", "archive", "favorite", "unfavorite"].includes(request.action)
    || request.items.length > 10000 || request.items.some(item => !item.id || !Number.isSafeInteger(item.expectedRevision) || item.expectedRevision < 0)
    || new Set(request.items.map(item => item.id)).size !== request.items.length) throw new Error("invalid_input: 批量笔记请求无效");
  const byId = new Map(pages.map(page => [page.id, page]));
  const children = new Map<NotePageId, NotePageId[]>();
  for (const page of pages) if (page.parentPageId) { const group = children.get(page.parentPageId) ?? []; group.push(page.id); children.set(page.parentPageId, group); }
  const cascade = cascadeOwnership&&(request.action === "trash" || request.action === "restore");
  const groups = request.items.map((item, index) => {
    const ids = new Set<NotePageId>([item.id]);
    if (cascade) for (const id of ids) for (const child of children.get(id) ?? []) ids.add(child);
    return {item, ids, parent: index};
  });
  const find = (index: number): number => { while (groups[index]!.parent !== index) { groups[index]!.parent = groups[groups[index]!.parent]!.parent; index = groups[index]!.parent; } return index; };
  const owner = new Map<NotePageId, number>();
  groups.forEach((group, index) => { for (const id of group.ids) { const previous = owner.get(id); if (previous !== undefined) groups[find(index)]!.parent = find(previous); owner.set(id, index); } });
  const failures = new Map<NotePageId, NoteMetadataBatchFailure>(), blocked = new Set<number>();
  const favorite = request.action === "favorite" || request.action === "unfavorite";
  groups.forEach(({item}, index) => {
    const page = byId.get(item.id);
    const failure: NoteMetadataBatchFailure | undefined = !page ? {id: item.id, code: "not_found", message: "找不到笔记"}
      : page.revision !== item.expectedRevision ? {id: item.id, code: "revision_conflict", message: "笔记已更新", currentRevision: page.revision}
      : favorite && (dependent.has(item.id) || page.status !== "active") ? {id: item.id, code: "invalid_input", message: "只能调整活动独立笔记的收藏"}
      : request.action !== "restore" && page.status === "trashed" ? {id: item.id, code: "invalid_input", message: "请先恢复回收站中的笔记"} : undefined;
    if (failure) { failures.set(item.id, failure); blocked.add(find(index)); }
  });
  const affected = new Set<NotePageId>(), succeededIds: NotePageId[] = [];
  groups.forEach(({item, ids}, index) => {
    if (blocked.has(find(index))) { if (!failures.has(item.id)) failures.set(item.id, {id: item.id, code: "revision_conflict", message: "同一归属组有未完成项，请刷新后重试"}); }
    else { succeededIds.push(item.id); for (const id of ids) affected.add(id); }
  });
  const status = request.action === "trash" ? "trashed" : request.action === "archive" ? "archived" : "active";
  const changed: NotePage[] = [], parents = new Set<NotePageId>();
  const updated = pages.map(page => {
    if (!affected.has(page.id) || (favorite ? page.isFavorite === (request.action === "favorite") : page.status === status)) return page;
    const {trashedAt: _trashedAt, ...base} = page;
    const next: NotePage = favorite ? {...page, isFavorite: request.action === "favorite", revision: page.revision + 1}
      : {...base, status, ...(status === "trashed" ? {trashedAt: timestamp} : {}), revision: page.revision + 1, updatedAt: timestamp};
    changed.push(next);
    if (!favorite && page.parentPageId) parents.add(page.parentPageId);
    return next;
  });
  return {pages: updated, changed, parentIds: [...parents], succeededIds, failures: [...failures.values()]};
}
