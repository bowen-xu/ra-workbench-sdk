import { expect, it } from "vitest";
import { blocksToEditor, editorToBlocks } from "./blockEditorCodec";
import { noteBlockId } from "./entities";
import type { NoteBlockV1 } from "./document";

it("round-trips page-link blocks through the existing reference wire format without changing ownership", () => {
  const original: NoteBlockV1 = { id: noteBlockId("page-link"), type: "researchObjectReference", props: {}, children: [],
    content: { kind: "reference", targetKind: "note_page", targetId: "target-page", labelSnapshot: "目标笔记", quoteSnapshot: "" } };
  const editor = blocksToEditor([original]);
  expect(editor[0]!.type).toBe("pageLink");
  expect(editorToBlocks(editor)).toEqual([original]);
  const legacy = { ...original, type: "childPage" as const };
  expect(editorToBlocks(blocksToEditor([legacy]))).toEqual([legacy]);
});
