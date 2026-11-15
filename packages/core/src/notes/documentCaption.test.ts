import { expect, it } from "vitest";
import { blocksToEditor, decodeNoteDocument, editorToBlocks } from "./index";

function document(kind: "image" | "table", caption: unknown = "") {
  return { schemaVersion: 1, pageId: "caption-page", blocks: [{ id: "caption-block", type: kind,
    props: kind === "image" ? { textAlignment: "right", previewWidth: 273.5 } : { caption, textAlignment: "center" },
    content: kind === "image" ? { kind: "asset", assetId: "a".repeat(64), displayName: "image.png", mimeType: "image/png", caption }
      : { kind: "table", rows: [[{ kind: "inline", items: [{ type: "text", text: "Cell", styles: [] }] }]] },
    children: [],
  }] };
}

it.each(["image", "table"] as const)("preserves literal %s caption newlines and presentation through save/reopen", kind => {
  const value = document(kind, "第一行\n\nSecond line\r\n😀");
  const decoded = decodeNoteDocument(JSON.parse(JSON.stringify(value)) as unknown);
  expect(decoded).toEqual(value);
  expect(editorToBlocks(blocksToEditor(decoded.blocks))).toEqual(decoded.blocks);
});

it.each(["image", "table"] as const)("accepts 4000 UTF-16 units in a %s caption", kind => {
  for (const caption of ["a".repeat(4000), "文".repeat(4000), "😀".repeat(2000), "文\n".repeat(2000)]) {
    expect(caption.length).toBe(4000);
    expect(decodeNoteDocument(document(kind, caption))).toEqual(document(kind, caption));
  }
});

it.each(["image", "table"] as const)("rejects more than 4000 UTF-16 units in a %s caption without truncation", kind => {
  for (const caption of ["a".repeat(4001), "文".repeat(4001), "😀".repeat(2000) + "a"]) {
    expect(() => decodeNoteDocument(document(kind, caption))).toThrow("说明");
  }
});

it.each([0, true, null, { text: "caption" }])("rejects the non-text table caption %s", caption => {
  expect(() => decodeNoteDocument(document("table", caption))).toThrow();
});

it("keeps a legacy table without a caption property unchanged", () => {
  const source = document("table");
  const value = { ...source, blocks: [{ ...source.blocks[0]!, props: { textAlignment: "center" } }] };
  const decoded = decodeNoteDocument(value);
  expect(decoded.blocks[0]?.props).not.toHaveProperty("caption");
  expect(editorToBlocks(blocksToEditor(decoded.blocks))).toEqual(decoded.blocks);
});
