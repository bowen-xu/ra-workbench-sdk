import { describe, expect, it } from "vitest";
import { blocksToEditor, decodeNoteBlocks, editorToBlocks } from "./index";

const asset = { assetId: "asset-id", displayName: "plot.png", mimeType: "image/png", caption: "Figure" };

describe("managed image presentation", () => {
  it.each(Array.from({length: 20}, (_, index) => (index + 1) * 5))("round trips percentage level %s through save/reopen", previewScale => {
    const value = editorToBlocks([{id: "image", type: "managedImage", props: {...asset, previewScale}}]);
    expect(value[0]?.props).toEqual({previewScale});
    const reopened = decodeNoteBlocks(JSON.parse(JSON.stringify(value)) as unknown);
    expect(editorToBlocks(blocksToEditor(reopened))).toEqual(value);
  });
  it.each([0, 4, 7, 101, NaN, Infinity, "50"])("omits invalid percentage %s without rounding stored content", previewScale => {
    expect(editorToBlocks([{id: "image", type: "managedImage", props: {...asset, previewScale}}])[0]?.props).toEqual({});
  });
  it.each(["left", "center", "right"])("persists %s alignment and width without duplicating resource or transient renderer state", textAlignment => {
    const blocks = editorToBlocks([{ id: "image", type: "managedImage", props: {
      ...asset, textAlignment, url: "blob:temporary-preview", previewWidth: 320,
    } }]);
    expect(blocks[0]).toEqual({ id: "image", type: "image", props: { textAlignment, previewWidth: 320 },
      content: { kind: "asset", ...asset }, children: [] });
    const reopened = decodeNoteBlocks(JSON.parse(JSON.stringify(blocks)) as unknown);
    expect(editorToBlocks(blocksToEditor(reopened))).toEqual(blocks);
  });

  it("restores persisted alignment and width alongside resource metadata", () => {
    const blocks = decodeNoteBlocks([{ id: "image", type: "image", props: { textAlignment: "right", previewWidth: 320 },
      content: { kind: "asset", ...asset }, children: [] }]);
    expect(blocksToEditor(blocks)[0]).toEqual({ id: "image", type: "managedImage",
      props: { ...asset, textAlignment: "right", previewWidth: 320 }, children: [] });
  });

  it("keeps old image documents without explicit alignment compatible", () => {
    const blocks = decodeNoteBlocks([{ id: "image", type: "image", props: {},
      content: { kind: "asset", ...asset }, children: [] }]);
    expect(blocksToEditor(blocks)[0]?.props).not.toHaveProperty("textAlignment");
    expect(blocksToEditor(blocks)[0]?.props).not.toHaveProperty("previewWidth");
    expect(editorToBlocks(blocksToEditor(blocks))).toEqual(blocks);
  });

  it("keeps image presentation out of file attachment properties", () => {
    const blocks = editorToBlocks([{ id: "file", type: "managedFile", props: { ...asset, textAlignment: "right", previewWidth: 320 } }]);
    expect(blocks[0]?.props).toEqual({});
    expect(blocks[0]?.content).toEqual({ kind: "asset", ...asset });
  });

  it.each([0.5, 64, 127.5, Number.MAX_VALUE])("round trips positive finite image width %s without applying UI bounds", previewWidth => {
    const blocks = editorToBlocks([{ id: "image", type: "managedImage", props: { ...asset, previewWidth } }]);
    expect(blocks[0]?.props).toEqual({ previewWidth });
    expect(blocksToEditor(blocks)[0]?.props).toEqual({ ...asset, previewWidth });
    expect(editorToBlocks(blocksToEditor(decodeNoteBlocks(JSON.parse(JSON.stringify(blocks)) as unknown)))).toEqual(blocks);
  });

  it.each([0, -1, NaN, Infinity, -Infinity, "320", null, undefined])("omits invalid or absent image width %s", previewWidth => {
    const blocks = editorToBlocks([{ id: "image", type: "managedImage", props: { ...asset, previewWidth } }]);
    expect(blocks[0]?.props).toEqual({});
    expect(blocksToEditor(blocks)[0]?.props).not.toHaveProperty("previewWidth");
  });
});

it("persists collapsible blocks, rich titles and child IDs across storage and reopening", () => {
  const blocks = editorToBlocks([{id: "toggle", type: "toggleListItem", props: {textColor: "green"},
    content: [{type: "text", text: "Title", styles: {bold: true}}, {type: "inlineFormula", props: {source: "x^2"}}],
    children: [{id: "nested", type: "heading", props: {level: 2, isToggleable: true}, content: "Child"}],
  }]);
  expect(blocks[0]?.type).toBe("toggleListItem");
  const reopened = decodeNoteBlocks(JSON.parse(JSON.stringify(blocks)) as unknown);
  expect(editorToBlocks(blocksToEditor(reopened))).toEqual(blocks);
  expect(reopened[0]?.children[0]?.props.isToggleable).toBe(true);
});
