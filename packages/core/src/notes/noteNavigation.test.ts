import { expect, it } from "vitest";
import { createNoteDocumentFromText, noteBlockId, notePageId } from "./index";
import { moveNavigationLink, navigationPageLinks } from "./noteNavigation";
import type { NoteBlockV1, NoteDocumentV1 } from "./document";
const page = (id: string) => createNoteDocumentFromText(notePageId(id), id, () => noteBlockId(`text-${id}`));
const link = (id: string, target = id): NoteBlockV1 => ({ id: noteBlockId(id), type: "researchObjectReference", props: {}, children: [], content: { kind: "reference", targetKind: "note_page", targetId: target, labelSnapshot: target, quoteSnapshot: "" } });
it("moves a link immediately above or below its actual nested anchor, retaining unrelated blocks and duplicate references", () => {
  const base = page("owner");
  const text = page("text").blocks[0]!;
  const document = { ...base, blocks: [base.blocks[0]!, { ...base.blocks[0]!, id: noteBlockId("parent"), children: [link("first", "shared"), text, link("second", "shared")] }] };
  const [result] = moveNavigationLink(new Map([[document.pageId, document]]), { pageId: notePageId("shared"), title: "title", parentPageId: document.pageId, blockId: noteBlockId("second") }, { pageId: document.pageId, anchorBlockId: noteBlockId("first"), placement: "before" }, "unused");
  expect(result!.blocks[0]).toEqual(base.blocks[0]);
  expect(result!.blocks[1]!.children.map(block => block.id)).toEqual(["second", "first", text.id]);
  expect(navigationPageLinks(result!).map(value => value.blockId)).toEqual(["second", "first"]);
});
it("moves across notes or out to favorites without deleting the linked page", () => {
  const a: NoteDocumentV1 = { ...page("a"), blocks: [link("link", "target")] }, b = page("b");
  const source = { pageId: notePageId("target"), title: "target", parentPageId: a.pageId, blockId: noteBlockId("link") };
  const result = moveNavigationLink(new Map([[a.pageId, a], [b.pageId, b]]), source, { pageId: b.pageId, placement: "inside" }, "unused");
  expect(result[0]!.blocks).toEqual([]); expect(result[1]!.blocks.at(-1)!.id).toBe("link");
  expect(moveNavigationLink(new Map([[a.pageId, a]]), source, undefined, "unused")[0]!.blocks).toEqual([]);
});
it("rejects stale links, self nesting and legacy ownership blocks", () => {
  const a: NoteDocumentV1 = { ...page("a"), blocks: [{ ...link("legacy", "target"), type: "childPage" }] };
  expect(() => moveNavigationLink(new Map([[a.pageId, a]]), { pageId: notePageId("target"), title: "", parentPageId: a.pageId, blockId: noteBlockId("legacy") }, undefined, "id")).toThrow("旧子页面");
  expect(() => moveNavigationLink(new Map(), { pageId: a.pageId, title: "" }, { pageId: a.pageId, placement: "inside" }, "id")).toThrow("自身");
});
