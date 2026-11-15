import { describe, expect, it } from "vitest";

import {
  assertValidNoteTree,
  createEmptyNoteDocument,
  decodeNoteDocument,
  inferReadingNoteType,
  noteBlockId,
  noteDocumentPlainText,
  notePageId,
  normalizeNoteTitle,
  blocksToEditor,
  editorToBlocks,
  type NoteDocumentV1,
} from "./index";

describe("NoteDocumentV1", () => {
  it("round-trips an application-owned document and extracts searchable text", () => {
    const document: NoteDocumentV1 = {
      schemaVersion: 1,
      pageId: notePageId("page-1"),
      blocks: [
        {
          id: noteBlockId("block-1"),
          type: "paragraph",
          props: {},
          content: {
            kind: "inline",
            items: [
              { type: "text", text: "研究", styles: ["bold"] },
              { type: "inlineFormula", source: "E=mc^2" },
            ],
          },
          children: [],
        },
        {
          id: noteBlockId("block-2"),
          type: "readingNoteReference",
          props: {},
          content: {
            kind: "reference",
            targetKind: "reading_note",
            targetId: "reading-1",
            labelSnapshot: "来源论文",
            quoteSnapshot: "引用原文",
          },
          children: [],
        },
      ],
    };

    expect(decodeNoteDocument(JSON.parse(JSON.stringify(document)))).toEqual(document);
    expect(noteDocumentPlainText(document)).toBe("研究E=mc^2\n来源论文 引用原文");
  });

  it("rejects duplicate block ids", () => {
    const block = createEmptyNoteDocument(notePageId("page-1"), noteBlockId("same")).blocks[0];
    expect(() => decodeNoteDocument({ schemaVersion: 1, pageId: "page-1", blocks: [block, block] }))
      .toThrow("重复的笔记块 ID");
  });

  it("rejects unknown document versions", () => {
    expect(() => decodeNoteDocument({ schemaVersion: 2, pageId: "page-1", blocks: [] }))
      .toThrow("不支持的笔记文档版本");
  });

  it("preserves unknown blocks as read-only application blocks", () => {
    const raw = {
      id: "future-block",
      type: "futureDiagram",
      props: { layout: { direction: "right" } },
      content: { nodes: [{ id: "a", label: "Result" }] },
      children: [],
    };
    const decoded = decodeNoteDocument({ schemaVersion: 1, pageId: "page-1", blocks: [raw] });
    expect(decoded.blocks[0]).toEqual(expect.objectContaining({
      id: "future-block",
      type: "unsupported",
      content: expect.objectContaining({ kind: "unsupported", originalType: "futureDiagram" }),
    }));
    expect((decoded.blocks[0]?.content as { readonly rawJson: string }).rawJson).toContain('"nodes"');
    expect(decodeNoteDocument(JSON.parse(JSON.stringify(decoded)))).toEqual(decoded);
    expect(noteDocumentPlainText(decoded)).toBe("[不支持的块：futureDiagram]");
  });

  it("rejects executable link protocols", () => {
    const document = createEmptyNoteDocument(notePageId("page-1"), noteBlockId("block-1"));
    expect(() => decodeNoteDocument({ ...document, blocks: [{
      ...document.blocks[0],
      content: { kind: "inline", items: [{ type: "link", href: "javascript:alert(1)", content: [{ type: "text", text: "unsafe", styles: [] }] }] },
    }] })).toThrow("链接协议");
  });

  it.each([
    ["source://library/paper/pdf:#line{3:12-4:14-20}", "source://library/paper/pdf:#line{3:12-4:14-20}"],
    ["source://notes/note:#block{block}#line{2-1:2-12}", "source://notes/note:#block{block}#line{2-1:2-12}"],
    ["source://library/paper-id", "source://library/paper-id"],
    ["source://notes/%E7%A0%94%E7%A9%B6", "source://notes/%E7%A0%94%E7%A9%B6"],
  ])("preserves source URI %s across editor round trips", (href, expected) => {
    const empty = createEmptyNoteDocument(notePageId("page-1"), noteBlockId("block-1"));
    const decoded = decodeNoteDocument({ ...empty, blocks: [{ ...empty.blocks[0], content: { kind: "inline", items: [
      { type: "link", href, content: [{ type: "text", text: "Source", styles: ["bold"] }] },
    ] } }] });
    expect(JSON.stringify(decoded)).toContain(expected);
    expect(editorToBlocks(blocksToEditor(decoded.blocks))).toEqual(decoded.blocks);
  });

  it.each(["javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "unknown://id"])("rejects unsupported link %s", href => {
    const empty = createEmptyNoteDocument(notePageId("page"), noteBlockId("block"));
    expect(() => decodeNoteDocument({ ...empty, blocks: [{ ...empty.blocks[0], content: { kind: "inline", items: [
      { type: "link", href, content: [] },
    ] } }] })).toThrow("链接协议");
  });
});

describe("note page invariants", () => {
  it("rejects page tree cycles", () => {
    const first = notePageId("first");
    const second = notePageId("second");
    expect(() => assertValidNoteTree([
      { id: first, parentPageId: second },
      { id: second, parentPageId: first },
    ])).toThrow("不能形成环路");
  });

  it("normalizes blank titles without inventing ownership", () => {
    expect(normalizeNoteTitle("   ")).toBe("无标题");
  });
});

describe("reading note migration", () => {
  it.each([
    ["highlight", "quoted", "highlight"],
    ["note", "quoted", "annotation"],
    ["note", "", "page_note"],
  ] as const)("maps %s with quote %s to %s", (annotationType, quote, expected) => {
    expect(inferReadingNoteType(annotationType, quote)).toBe(expected);
  });
});

it("validates styled reference labels while rejecting nested identities and unsafe colors", () => {
  const mention = { type: "mention", targetKind: "paper", targetId: "paper", labelSnapshot: "Title", content: [
    { type: "text", text: "Title", styles: ["italic", "underline"], textColor: "blue" },
  ] };
  const document = { schemaVersion: 1, pageId: "page", blocks: [{ id: "block", type: "paragraph", props: {}, children: [], content: { kind: "inline", items: [mention] } }] };
  expect(decodeNoteDocument(document)).toEqual(document);
  expect(() => decodeNoteDocument({ ...document, blocks: [{ ...document.blocks[0], content: { kind: "inline", items: [{ ...mention, content: [mention] }] } }] })).toThrow("引用名称只能包含文本");
  expect(() => decodeNoteDocument({ ...document, blocks: [{ ...document.blocks[0], content: { kind: "inline", items: [{ ...mention, content: [{ ...mention.content[0], textColor: "url(evil)" }] }] } }] })).toThrow("文本颜色无效");
});
