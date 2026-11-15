import { noteBlockId, notePageId, type NoteBlockId, type NotePageId } from "./entities";

export const NOTE_DOCUMENT_SCHEMA_VERSION = 1 as const;
export const MAX_NOTE_BLOCKS = 20_000;
export const MAX_NOTE_DEPTH = 64;
export const MAX_NOTE_TEXT_LENGTH = 2_000_000;

export type NoteTextStyle = "bold" | "italic" | "underline" | "strike" | "code";

export interface NoteTextContentV1 {
  readonly type: "text";
  readonly text: string;
  readonly styles: readonly NoteTextStyle[];
  readonly textColor?: string;
  readonly backgroundColor?: string;
}

export interface NoteLinkContentV1 {
  readonly type: "link";
  readonly href: string;
  readonly content: readonly NoteTextContentV1[];
}

export interface NoteInlineFormulaV1 {
  readonly type: "inlineFormula";
  readonly source: string;
}

export interface NoteMentionContentV1 {
  readonly type: "mention";
  readonly targetKind: "note_page" | "reading_note" | "paper" | "claim" | "manuscript";
  readonly targetId: string;
  readonly labelSnapshot: string;
  readonly content?: readonly NoteTextContentV1[];
}

export type NoteInlineContentV1 =
  | NoteTextContentV1
  | NoteLinkContentV1
  | NoteInlineFormulaV1
  | NoteMentionContentV1;

export function isAllowedNoteHref(value: string): boolean {
  if (value.startsWith("#")) return true;
  const schemeEnd = value.indexOf(":");
  if (schemeEnd <= 0) return false;
  return ["https", "http", "mailto", "source"].includes(value.slice(0, schemeEnd).toLocaleLowerCase());
}

export interface NoteInlineBlockContentV1 {
  readonly kind: "inline";
  readonly items: readonly NoteInlineContentV1[];
}

export interface NoteTableContentV1 {
  readonly kind: "table";
  readonly headerRows?: number;
  readonly headerCols?: number;
  readonly rows: readonly (readonly NoteInlineBlockContentV1[])[];
}

export interface NoteAssetContentV1 {
  readonly kind: "asset";
  readonly assetId: string;
  readonly displayName: string;
  readonly mimeType: string;
  readonly caption: string;
}

export interface NoteFormulaContentV1 {
  readonly kind: "formula";
  readonly source: string;
}

export interface NoteReferenceContentV1 {
  readonly kind: "reference";
  readonly targetKind: "note_page" | "reading_note" | "paper" | "claim" | "manuscript";
  readonly targetId: string;
  readonly labelSnapshot: string;
  readonly quoteSnapshot: string;
}

export interface NoteEmptyContentV1 {
  readonly kind: "none";
}

export interface NoteUnsupportedContentV1 {
  readonly kind: "unsupported";
  readonly originalType: string;
  readonly rawJson: string;
}

export type NoteBlockContentV1 =
  | NoteInlineBlockContentV1
  | NoteTableContentV1
  | NoteAssetContentV1
  | NoteFormulaContentV1
  | NoteReferenceContentV1
  | NoteEmptyContentV1
  | NoteUnsupportedContentV1;

export type NoteBlockType =
  | "paragraph"
  | "heading"
  | "bulletListItem"
  | "numberedListItem"
  | "checkListItem"
  | "toggleListItem"
  | "quote"
  | "codeBlock"
  | "divider"
  | "table"
  | "image"
  | "file"
  | "formulaBlock"
  | "childPage"
  | "readingNoteReference"
  | "researchObjectReference"
  | "unsupported";

export interface NoteBlockV1 {
  readonly id: NoteBlockId;
  readonly type: NoteBlockType;
  readonly props: Readonly<Record<string, string | number | boolean>>;
  readonly content: NoteBlockContentV1;
  readonly children: readonly NoteBlockV1[];
}

export interface NoteDocumentV1 {
  /** Page title participates in the same HBS operation as its body. Omitted by legacy/body-only consumers. */
  readonly title?: string;
  readonly schemaVersion: typeof NOTE_DOCUMENT_SCHEMA_VERSION;
  readonly pageId: NotePageId;
  readonly blocks: readonly NoteBlockV1[];
}

const BLOCK_TYPES = new Set<NoteBlockType>([
  "paragraph", "heading", "bulletListItem", "numberedListItem", "checkListItem", "toggleListItem",
  "quote", "codeBlock", "divider", "table", "image", "file", "formulaBlock",
  "childPage", "readingNoteReference", "researchObjectReference", "unsupported",
]);
const TEXT_STYLES = new Set<NoteTextStyle>(["bold", "italic", "underline", "strike", "code"]);

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} 必须是对象`);
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, label: string, maxLength = MAX_NOTE_TEXT_LENGTH): string {
  if (typeof value !== "string" || value.length > maxLength) {
    throw new Error(`${label} 无效`);
  }
  return value;
}

const NOTE_COLORS = new Set(["default", "gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"]);
function decodeTextColors(item: Record<string, unknown>): Pick<NoteTextContentV1, "textColor" | "backgroundColor"> {
  const colors: { textColor?: string; backgroundColor?: string } = {};
  for (const key of ["textColor", "backgroundColor"] as const) {
    if (item[key] === undefined) continue;
    if (typeof item[key] !== "string" || !NOTE_COLORS.has(item[key])) throw new Error("文本颜色无效");
    colors[key] = item[key];
  }
  return colors;
}

function decodeInline(value: unknown): NoteInlineContentV1 {
  const item = asRecord(value, "行内内容");
  if (item.type === "text") {
    if (!Array.isArray(item.styles) || item.styles.some((style) => !TEXT_STYLES.has(style as NoteTextStyle))) {
      throw new Error("文本样式无效");
    }
    return { type: "text", text: asString(item.text, "文本"), styles: item.styles as NoteTextStyle[], ...decodeTextColors(item) };
  }
  if (item.type === "link") {
    if (!Array.isArray(item.content)) throw new Error("链接文本无效");
    const content = item.content.map((part) => decodeInline(part));
    if (content.some((part) => part.type !== "text")) throw new Error("链接只能包含文本");
    const href = asString(item.href, "链接", 4_096);
    if (!isAllowedNoteHref(href)) throw new Error("链接协议不安全或不受支持");
    return { type: "link", href, content: content as NoteTextContentV1[] };
  }
  if (item.type === "inlineFormula") {
    return { type: "inlineFormula", source: asString(item.source, "行内公式", 32_768) };
  }
  if (item.type === "mention") {
    const targetKind = item.targetKind as NoteMentionContentV1["targetKind"];
    if (!["note_page", "reading_note", "paper", "claim", "manuscript"].includes(targetKind)) {
      throw new Error("提及目标类型无效");
    }
    let content: NoteTextContentV1[] | undefined;
    if (item.content !== undefined) {
      if (!Array.isArray(item.content)) throw new Error("引用文本无效");
      content = item.content.map(part => {
        if (asRecord(part, "引用文本").type !== "text") throw new Error("引用名称只能包含文本");
        const decoded = decodeInline(part);
        if (decoded.type !== "text") throw new Error("引用名称只能包含文本");
        return decoded;
      });
    }
    return {
      ...(content === undefined ? {} : { content }),
      type: "mention", targetKind, targetId: asString(item.targetId, "提及目标", 128),
      labelSnapshot: asString(item.labelSnapshot, "提及标签", 1_000),
    };
  }
  throw new Error("不支持的行内内容");
}

function decodeInlineContainer(value: unknown): NoteInlineBlockContentV1 {
  const content = asRecord(value, "行内块内容");
  if (content.kind !== "inline" || !Array.isArray(content.items)) throw new Error("行内块内容无效");
  return { kind: "inline", items: content.items.map(decodeInline) };
}

function decodeContent(value: unknown): NoteBlockContentV1 {
  const content = asRecord(value, "块内容");
  if (content.kind === "inline") return decodeInlineContainer(content);
  if (content.kind === "none") return { kind: "none" };
  if (content.kind === "unsupported") {
    return {
      kind: "unsupported",
      originalType: asString(content.originalType, "原始块类型", 256),
      rawJson: asString(content.rawJson, "原始块数据"),
    };
  }
  if (content.kind === "formula") return { kind: "formula", source: asString(content.source, "公式", 32_768) };
  if (content.kind === "asset") {
    return {
      kind: "asset", assetId: asString(content.assetId, "资产 ID", 128),
      displayName: asString(content.displayName, "资产名称", 1_000),
      mimeType: asString(content.mimeType, "MIME", 255), caption: asString(content.caption, "说明", 4_000),
    };
  }
  if (content.kind === "reference") {
    const targetKind = content.targetKind as NoteReferenceContentV1["targetKind"];
    if (!["note_page", "reading_note", "paper", "claim", "manuscript"].includes(targetKind)) throw new Error("引用目标类型无效");
    return {
      kind: "reference", targetKind, targetId: asString(content.targetId, "引用目标", 128),
      labelSnapshot: asString(content.labelSnapshot, "引用标签", 1_000),
      quoteSnapshot: asString(content.quoteSnapshot, "引用快照"),
    };
  }
  if (content.kind === "table") {
    if (!Array.isArray(content.rows)) throw new Error("表格内容无效");
    const headers: {headerRows?: number; headerCols?: number} = {};
    for (const key of ["headerRows", "headerCols"] as const) {
      const count = content[key];
      if (count === undefined || count === 0) continue;
      if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0 || count > 10_000) throw new Error("表格表头数量无效");
      headers[key] = count;
    }
    return { kind: "table", ...headers, rows: content.rows.map((row) => {
      if (!Array.isArray(row)) throw new Error("表格行无效");
      return row.map(decodeInlineContainer);
    }) };
  }
  throw new Error("不支持的块内容");
}

function decodeProps(value: unknown, type: NoteBlockType): Readonly<Record<string, string | number | boolean>> {
  const props = asRecord(value, "块属性");
  if (type === "table" && "caption" in props) asString(props.caption, "表格说明", 4_000);
  for (const prop of Object.values(props)) {
    if (!["string", "number", "boolean"].includes(typeof prop)) throw new Error("块属性值无效");
  }
  return props as Record<string, string | number | boolean>;
}

export function decodeNoteDocument(value: unknown): NoteDocumentV1 {
  const document = asRecord(value, "笔记文档");
  if (document.schemaVersion !== NOTE_DOCUMENT_SCHEMA_VERSION || !Array.isArray(document.blocks)) {
    throw new Error("不支持的笔记文档版本");
  }
  if (document.title !== undefined && (typeof document.title !== "string" || /[\r\n]/u.test(document.title))) throw new Error("页面标题须为单行文本");
  return { schemaVersion: NOTE_DOCUMENT_SCHEMA_VERSION, pageId: notePageId(asString(document.pageId, "页面 ID", 128)),
    ...(document.title === undefined ? {} : {title: asString(document.title, "页面标题", 240)}), blocks: decodeNoteBlocks(document.blocks) };
}

/** Validate portable blocks without assigning document ownership. */
export function decodeNoteBlocks(blocks: unknown): readonly NoteBlockV1[] {
  if (!Array.isArray(blocks)) throw new Error("笔记块数组无效");
  let blockCount = 0;
  const seen = new Set<string>();
  const decodeBlock = (raw: unknown, depth: number): NoteBlockV1 => {
    if (depth > MAX_NOTE_DEPTH || ++blockCount > MAX_NOTE_BLOCKS) throw new Error("笔记结构超过安全限制");
    const block = asRecord(raw, "笔记块");
    const id = noteBlockId(asString(block.id, "块 ID", 128));
    if (seen.has(id)) throw new Error(`重复的笔记块 ID：${id}`);
    seen.add(id);
    const originalType = asString(block.type, "笔记块类型", 256);
    if (!Array.isArray(block.children)) throw new Error("笔记块子块无效");
    const type = originalType as NoteBlockType;
    if (!BLOCK_TYPES.has(type)) {
      const rawJson = JSON.stringify(block);
      if (rawJson.length > MAX_NOTE_TEXT_LENGTH) throw new Error("未知笔记块数据过大");
      return {
        id,
        type: "unsupported",
        props: { originalType },
        content: { kind: "unsupported", originalType, rawJson },
        children: block.children.map((child) => decodeBlock(child, depth + 1)),
      };
    }
    return { id, type, props: decodeProps(block.props, type), content: decodeContent(block.content), children: block.children.map((child) => decodeBlock(child, depth + 1)) };
  };
  return blocks.map((block) => decodeBlock(block, 1));
}

export function createEmptyNoteDocument(pageId: NotePageId, blockId: NoteBlockId): NoteDocumentV1 {
  return { schemaVersion: NOTE_DOCUMENT_SCHEMA_VERSION, pageId, blocks: [{ id: blockId, type: "paragraph", props: {}, content: { kind: "inline", items: [] }, children: [] }] };
}

/** Plain text import preserves newlines literally; it never parses Markdown. */
export function createNoteDocumentFromText(pageId: NotePageId, text: string, nextId: () => NoteBlockId): NoteDocumentV1 {
  return { schemaVersion: 1, pageId, blocks: (text === "" ? [] : text.split("\n")).map(line => ({
    id: nextId(), type: "paragraph", props: {},
    content: { kind: "inline", items: line === "" ? [] : [{ type: "text", text: line, styles: [] }] },
    children: [],
  })) };
}

export function noteDocumentPlainText(document: NoteDocumentV1): string {
  const lines: string[] = [];
  const appendInline = (content: NoteInlineBlockContentV1) => content.items.map((item) => {
    if (item.type === "text") return item.text;
    if (item.type === "link") return item.content.map((part) => part.text).join("");
    if (item.type === "inlineFormula") return item.source;
    return item.content?.map(part => part.text).join("") ?? item.labelSnapshot;
  }).join("");
  const visit = (block: NoteBlockV1): void => {
    if (block.content.kind === "inline") lines.push(appendInline(block.content));
    else if (block.content.kind === "formula") lines.push(block.content.source);
    else if (block.content.kind === "asset") lines.push([block.content.displayName, block.content.caption].filter(Boolean).join(" "));
    else if (block.content.kind === "reference") lines.push([block.content.labelSnapshot, block.content.quoteSnapshot].filter(Boolean).join(" "));
    else if (block.content.kind === "table") lines.push(...block.content.rows.map((row) => row.map(appendInline).join("\t")));
    else if (block.content.kind === "unsupported") lines.push(`[不支持的块：${block.content.originalType}]`);
    block.children.forEach(visit);
  };
  document.blocks.forEach(visit);
  return lines.filter(Boolean).join("\n");
}
