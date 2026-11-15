import { noteBlockId, type NoteBlockId, type NotePageId } from "./entities";
import type { NoteBlockV1, NoteDocumentV1 } from "./document";

export interface NavigationPageLink {
  readonly blockId: NoteBlockId; readonly pageId: NotePageId; readonly label: string; readonly legacy: boolean;
}
/** Only whole-block page links participate; inline @ mentions are not tree rows. */
export function navigationPageLinks(document: NoteDocumentV1): readonly NavigationPageLink[] {
  const result: NavigationPageLink[] = [];
  function visit(blocks: readonly NoteBlockV1[]): void {
    for (const block of blocks) {
      if (block.content.kind === "reference" && block.content.targetKind === "note_page") result.push({
        blockId: block.id, pageId: block.content.targetId as NotePageId, label: block.content.labelSnapshot, legacy: block.type === "childPage",
      });
      visit(block.children);
    }
  }
  visit(document.blocks); return result;
}
export interface NavigationLinkSource { readonly pageId: NotePageId; readonly title: string; readonly parentPageId?: NotePageId; readonly blockId?: NoteBlockId }
export interface NavigationLinkDestination { readonly pageId: NotePageId; readonly anchorBlockId?: NoteBlockId; readonly placement: "before" | "after" | "inside" }
/** Move a link, preserving every other block and the anchor's actual nesting.
 * Legacy childPage blocks carry deletion ownership and cannot be detached here.
 */
export function moveNavigationLink(documents: ReadonlyMap<NotePageId, NoteDocumentV1>, source: NavigationLinkSource,
  destination: NavigationLinkDestination | undefined, newBlockId: string): readonly NoteDocumentV1[] {
  if (destination?.pageId === source.pageId) throw new Error("不能把页面链接放入它自身。");
  const changed = new Map<NotePageId, NoteDocumentV1>();
  let moving: NoteBlockV1 = { id: noteBlockId(newBlockId), type: "researchObjectReference", props: {pageEntry:true}, children: [],
    content: { kind: "reference", targetKind: "note_page", targetId: source.pageId, labelSnapshot: source.title, quoteSnapshot: "" } };
  if (source.parentPageId && source.blockId) {
    const parent = documents.get(source.parentPageId);
    if (!parent) throw new Error("来源笔记未能读取，请重新展开后重试。");
    let found = false;
    function remove(blocks: readonly NoteBlockV1[]): readonly NoteBlockV1[] {
      return blocks.flatMap(block => {
        if (block.id === source.blockId) {
          if (block.type === "childPage") throw new Error("旧子页面具有独立的删除归属，请先在正文中整理该子页面。");
          if (block.content.kind !== "reference" || block.content.targetKind !== "note_page" || block.content.targetId !== source.pageId) throw new Error("来源链接已变化，请刷新后重试。");
          moving = block; found = true; return [];
        }
        return [{ ...block, children: remove(block.children) }];
      });
    }
    const blocks = remove(parent.blocks);
    if (!found) throw new Error("来源链接已变化，请刷新后重试。");
    changed.set(parent.pageId, { ...parent, blocks });
  }
  if (destination) {
    const target = changed.get(destination.pageId) ?? documents.get(destination.pageId);
    if (!target) throw new Error("目标笔记未能读取，请重试。");
    if (!destination.anchorBlockId || destination.placement === "inside") changed.set(target.pageId, { ...target, blocks: [...target.blocks, moving] });
    else {
      let found = false;
      function insert(blocks: readonly NoteBlockV1[]): readonly NoteBlockV1[] {
        return blocks.flatMap(block => {
          if (block.id === destination!.anchorBlockId) { found = true; return destination!.placement === "before" ? [moving, block] : [block, moving]; }
          return [{ ...block, children: insert(block.children) }];
        });
      }
      const blocks = insert(target.blocks);
      if (!found) throw new Error("目标链接已变化，请刷新后重试。");
      changed.set(target.pageId, { ...target, blocks });
    }
  }
  return [...changed.values()];
}
