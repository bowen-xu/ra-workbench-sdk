import { describe, expect, it } from "vitest";
import { blocksToEditor, editorToBlocks } from "@research-assistant/core/notes";
import { createWritingNote, decodeWritingNote, isWritingSourcePath, writingNotePath } from "./writingNote";

describe("manuscript-owned notes", () => {
  it("round trips owned blocks without a global page identity", () => {
    const note = createWritingNote("writing-ideas", "stable-block");
    expect(decodeWritingNote(JSON.stringify(note))).toEqual(note);
    expect(editorToBlocks(blocksToEditor(note.blocks))).toEqual(note.blocks);
    expect(note).not.toHaveProperty("pageId");
  });
  it("excludes only notes and owned resources from source inputs", () => {
    for (const path of ["notes/ideas.ranote", "Ideas.RANOTE", ".ranote-assets/id"]) expect(isWritingSourcePath(path)).toBe(false);
    for (const path of ["notes/main.tex", "main.tex", "references.bib", "figures/a.png"]) expect(isWritingSourcePath(path)).toBe(true);
  });
  it("rejects malformed versions, duplicate IDs and path escape", () => {
    const note = createWritingNote("ideas", "stable-block");
    expect(() => decodeWritingNote(JSON.stringify({ ...note, schemaVersion: 2 }))).toThrow();
    expect(() => decodeWritingNote(JSON.stringify({ ...note, blocks: [...note.blocks, ...note.blocks] }))).toThrow();
    expect(() => writingNotePath("../ideas")).toThrow();
    expect(writingNotePath("写作思路")).toBe("notes/写作思路.ranote");
  });
  it("preserves nested blocks, formula, table and asset data", () => {
    const blocks = editorToBlocks([
      { id: "parent", type: "paragraph", content: [{ type: "text", text: "Ideas", styles: { bold: true } }], children: [
        { id: "quote", type: "quote", content: "A quote" },
      ] },
      { id: "formula", type: "formulaBlock", props: { source: "E=mc^2" } },
      { id: "table", type: "table", content: { rows: [{ cells: [[{ type: "text", text: "cell", styles: {} }]] }] } },
      { id: "asset", type: "managedImage", props: { assetId: "asset-id", mimeType: "image/png", displayName: "plot.png", caption: "Figure" } },
    ]);
    const note = decodeWritingNote(JSON.stringify({ schemaVersion: 1, noteId: "ideas", blocks }));
    expect(editorToBlocks(blocksToEditor(note.blocks))).toEqual(blocks);
  });
  it.each(["left", "center", "right"])("reopens a nested image with its %s alignment, width and caption intact", textAlignment => {
    const blocks = editorToBlocks([{ id: "parent", type: "paragraph", content: "Results", children: [
      { id: "image", type: "managedImage", props: { assetId: "asset-id", displayName: "plot.png",
        mimeType: "image/png", caption: "Experiment result", textAlignment, previewWidth: 273.5 } },
    ] }]);
    const note = decodeWritingNote(JSON.stringify({ schemaVersion: 1, noteId: "ideas", blocks }));
    expect(note.blocks[0]?.children[0]).toMatchObject({ props: { textAlignment, previewWidth: 273.5 },
      content: { kind: "asset", assetId: "asset-id", displayName: "plot.png", mimeType: "image/png", caption: "Experiment result" } });
    const reopened = blocksToEditor(note.blocks);
    expect(reopened[0]?.children?.[0]?.props).toMatchObject({ textAlignment, previewWidth: 273.5, caption: "Experiment result" });
    expect(editorToBlocks(reopened)).toEqual(note.blocks);
  });
});

it("initializes a new named note with a durable level-one heading", () => {
  const note = createWritingNote("note", "heading", "实验记录");
  const restored = decodeWritingNote(JSON.stringify(note));
  expect(restored.blocks[0]).toMatchObject({ id: "heading", type: "heading", props: { level: 1 }, content: { kind: "inline", items: [{ type: "text", text: "实验记录", styles: [] }] } });
});
