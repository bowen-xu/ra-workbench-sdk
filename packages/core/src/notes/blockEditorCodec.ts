import {
  decodeNoteBlocks,
  isAllowedNoteHref,
  type NoteBlockContentV1,
  type NoteBlockType,
  type NoteBlockV1,
  type NoteInlineBlockContentV1,
  type NoteInlineContentV1,
  type NoteTextContentV1,
  type NoteTextStyle,
} from "./document";

import { noteBlockId } from "./entities";

export interface PortableEditorBlock {
  readonly id: string;
  readonly type: string;
  readonly props?: Readonly<Record<string, unknown>>;
  readonly content?: unknown;
  readonly children?: readonly PortableEditorBlock[];
}

const TEXT_STYLE_KEYS: readonly NoteTextStyle[] = ["bold", "italic", "underline", "strike", "code"];

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function textStylesToEditor(styles: readonly NoteTextStyle[]): Record<string, boolean> {
  return Object.fromEntries(styles.map((style) => [style, true]));
}

function textStylesFromEditor(value: unknown): readonly NoteTextStyle[] {
  const styles = asRecord(value);
  return TEXT_STYLE_KEYS.filter((style) => styles[style] === true);
}

function textColorsToEditor(item: NoteTextContentV1): Record<string, string> {
  return { ...(item.textColor === undefined ? {} : { textColor: item.textColor }),
    ...(item.backgroundColor === undefined ? {} : { backgroundColor: item.backgroundColor }) };
}
function textColorsFromEditor(value: unknown): Pick<NoteTextContentV1, "textColor" | "backgroundColor"> {
  const styles = asRecord(value);
  return { ...(typeof styles.textColor === "string" && styles.textColor !== "default" ? { textColor: styles.textColor } : {}),
    ...(typeof styles.backgroundColor === "string" && styles.backgroundColor !== "default" ? { backgroundColor: styles.backgroundColor } : {}) };
}

function inlineToEditor(item: NoteInlineContentV1): unknown {
  if (item.type === "text") {
    return { type: "text", text: item.text, styles: { ...textStylesToEditor(item.styles), ...textColorsToEditor(item) } };
  }
  if (item.type === "link") {
    return {
      type: "link",
      href: item.href,
      content: item.content.map((part) => ({
        type: "text",
        text: part.text,
        styles: { ...textStylesToEditor(part.styles), ...textColorsToEditor(part) },
      })),
    };
  }
  if (item.type === "inlineFormula") {
    return { type: "inlineFormula", props: { source: item.source } };
  }
  return {
    type: "researchMention",
    content: (item.content ?? [{ type: "text", text: item.labelSnapshot, styles: ["bold"] }]).map(inlineToEditor),
    props: {
      targetKind: item.targetKind,
      targetId: item.targetId,
      labelSnapshot: item.labelSnapshot,
    },
  };
}

function inlineFromEditor(value: unknown): NoteInlineContentV1 | undefined {
  if (typeof value === "string") return { type: "text", text: value, styles: [] };
  const item = asRecord(value);
  if (item.type === "text") {
    return {
      type: "text",
      text: typeof item.text === "string" ? item.text : "",
      styles: textStylesFromEditor(item.styles), ...textColorsFromEditor(item.styles),
    };
  }
  if (item.type === "link") {
    const content = Array.isArray(item.content)
      ? item.content.map((part): NoteTextContentV1 => {
          const text = asRecord(part);
          return {
            type: "text",
            text: typeof text.text === "string" ? text.text : "",
            styles: textStylesFromEditor(text.styles), ...textColorsFromEditor(text.styles),
          };
        })
      : [];
    const href = typeof item.href === "string" ? item.href : "";
    if (!isAllowedNoteHref(href)) {
      return { type: "text", text: content.map((part) => part.text).join(""), styles: [] };
    }
    return { type: "link", href, content };
  }
  const props = asRecord(item.props);
  if (item.type === "inlineFormula") {
    return { type: "inlineFormula", source: typeof props.source === "string" ? props.source : "" };
  }
  if (item.type === "researchMention") {
    const targetKind = typeof props.targetKind === "string" ? props.targetKind : "paper";
    if (!["note_page", "reading_note", "paper", "claim", "manuscript"].includes(targetKind)) return undefined;
    const content = Array.isArray(item.content) ? item.content.map(inlineFromEditor).filter((part): part is NoteTextContentV1 => part?.type === "text") : undefined;
    const defaultLabel = content?.length === 1 && content[0]?.text === props.labelSnapshot
      && content[0]?.styles.length === 1 && content[0]?.styles[0] === "bold"
      && content[0]?.textColor === undefined && content[0]?.backgroundColor === undefined;
    return {
      ...(content === undefined || defaultLabel ? {} : { content }),
      type: "mention",
      targetKind: targetKind as "note_page" | "reading_note" | "paper" | "claim" | "manuscript",
      targetId: typeof props.targetId === "string" ? props.targetId : "",
      labelSnapshot: typeof props.labelSnapshot === "string" ? props.labelSnapshot : "研究对象",
    };
  }
  return undefined;
}

function inlineContainerFromEditor(value: unknown): NoteInlineBlockContentV1 {
  if (typeof value === "string") {
    return { kind: "inline", items: [{ type: "text", text: value, styles: [] }] };
  }
  const items = Array.isArray(value) ? value.map(inlineFromEditor).filter((item) => item !== undefined) : [];
  return { kind: "inline", items };
}

function appProps(value: unknown): Readonly<Record<string, string | number | boolean>> {
  return Object.fromEntries(Object.entries(asRecord(value)).filter((entry): entry is [string, string | number | boolean] =>
    ["string", "number", "boolean"].includes(typeof entry[1])));
}

function imageProps(value: unknown): Readonly<Record<string, string | number>> {
  const { textAlignment, previewWidth, previewScale } = asRecord(value);
  return {
    ...(textAlignment === "left" || textAlignment === "center" || textAlignment === "right" ? { textAlignment } : {}),
    ...(typeof previewWidth === "number" && Number.isFinite(previewWidth) && previewWidth > 0 ? { previewWidth } : {}),
    ...(typeof previewScale === "number" && previewScale >= 5 && previewScale <= 100 && previewScale % 5 === 0 ? { previewScale } : {}),
  };
}

function inlineText(content: NoteInlineBlockContentV1): string {
  return content.items.map((item) => {
    if (item.type === "text") return item.text;
    if (item.type === "link") return item.content.map((part) => part.text).join("");
    if (item.type === "inlineFormula") return item.source;
    return item.labelSnapshot;
  }).join("");
}

export function blocksToEditor(blocks: readonly NoteBlockV1[]): PortableEditorBlock[] {
  const convert = (block: NoteBlockV1): PortableEditorBlock => {
    const base = { id: block.id, type: block.type, props: { ...block.props }, children: block.children.map(convert) };
    if (block.content.kind === "unsupported") {
      return { ...base, type: "unsupportedBlock", props: { originalType: block.content.originalType, rawJson: block.content.rawJson } } as PortableEditorBlock;
    }
    if (block.content.kind === "formula") {
      return { ...base, type: "formulaBlock", props: { source: block.content.source } } as PortableEditorBlock;
    }
    if (block.content.kind === "reference") {
      const type = block.type === "childPage"
        ? "childPage"
        : block.content.targetKind === "note_page" ? "pageLink" : "referenceLink";
      return { ...base, type, props: {
        ...(block.props.pageEntry===true ? {pageEntry:true} : {}),
        ...(type === "referenceLink" ? { referenceType: block.type } : {}),
        targetKind: block.content.targetKind, targetId: block.content.targetId,
        labelSnapshot: block.content.labelSnapshot, quoteSnapshot: block.content.quoteSnapshot,
      } } as PortableEditorBlock;
    }
    if (block.content.kind === "asset") {
      return {
        ...base,
        type: block.type === "image" ? "managedImage" : "managedFile",
        props: {
          ...(block.type === "image" ? imageProps(block.props) : {}),
          assetId: block.content.assetId,
          displayName: block.content.displayName,
          mimeType: block.content.mimeType,
          caption: block.content.caption,
        },
      } as PortableEditorBlock;
    }
    if (block.content.kind === "table") {
      return { ...base, type: "table", content: {
        type: "tableContent", columnWidths: [],
        ...(block.content.headerRows ? {headerRows: block.content.headerRows} : {}),
        ...(block.content.headerCols ? {headerCols: block.content.headerCols} : {}),
        rows: block.content.rows.map((row) => ({ cells: row.map((cell) => cell.items.map(inlineToEditor)) })),
      } } as PortableEditorBlock;
    }
    if (block.content.kind === "inline") {
      return { ...base, content: block.type === "codeBlock" ? inlineText(block.content) : block.content.items.map(inlineToEditor) } as PortableEditorBlock;
    }
    return base as PortableEditorBlock;
  };
  return blocks.map(convert);
}

function editorContent(block: PortableEditorBlock): NoteBlockContentV1 {
  const value = block as unknown as Record<string, unknown>;
  const type = String(value.type ?? "paragraph");
  const props = asRecord(value.props);
  if (type === "unsupportedBlock") {
    return {
      kind: "unsupported",
      originalType: typeof props.originalType === "string" ? props.originalType : "unknown",
      rawJson: typeof props.rawJson === "string" ? props.rawJson : "{}",
    };
  }
  if (type === "formulaBlock") return { kind: "formula", source: typeof props.source === "string" ? props.source : "" };
  if (type === "pageLink" || type === "childPage" || type === "referenceLink") {
    const targetKind = type === "childPage" || type === "pageLink" ? "note_page" : String(props.targetKind ?? "paper");
    return {
      kind: "reference",
      targetKind: targetKind as "note_page" | "reading_note" | "paper" | "claim" | "manuscript",
      targetId: String(props.targetId ?? ""), labelSnapshot: String(props.labelSnapshot ?? "研究对象"),
      quoteSnapshot: String(props.quoteSnapshot ?? ""),
    };
  }
  if (type === "managedImage" || type === "managedFile" || type === "image" || type === "file") {
    return {
      kind: "asset", assetId: String(props.assetId ?? props.url ?? ""),
      displayName: String(props.displayName ?? props.name ?? "附件"), mimeType: String(props.mimeType ?? "application/octet-stream"),
      caption: String(props.caption ?? ""),
    };
  }
  if (type === "divider") return { kind: "none" };
  const content = value.content;
  if (type === "table") {
    const table = asRecord(content);
    const rows = Array.isArray(table.rows) ? table.rows.map((rawRow) => {
      const row = asRecord(rawRow);
      return Array.isArray(row.cells) ? row.cells.map((cell) => {
        const cellValue = asRecord(cell);
        return inlineContainerFromEditor(Array.isArray(cell) ? cell : cellValue.content);
      }) : [];
    }) : [];
    const {headerRows, headerCols} = table;
    if (headerRows !== undefined && typeof headerRows !== "number" || headerCols !== undefined && typeof headerCols !== "number") {
      throw new Error("表格表头数量无效");
    }
    return { kind: "table", rows,
      ...(headerRows === undefined || headerRows === 0 ? {} : {headerRows}),
      ...(headerCols === undefined || headerCols === 0 ? {} : {headerCols}),
    };
  }
  return inlineContainerFromEditor(content);
}

function domainProps(editorType: string, value: unknown): Readonly<Record<string, string | number | boolean>> {
  if(editorType==="pageLink" || editorType==="referenceLink")return asRecord(value).pageEntry===true ? {pageEntry:true} : {};
  // Custom block props transport semantic content through BlockNote. Keeping
  // them in the application props too would duplicate data and make the
  // persisted document dependent on the editor adapter's private shape.
  if (editorType === "unsupportedBlock") {
    const props = asRecord(value);
    return { originalType: typeof props.originalType === "string" ? props.originalType : "unknown" };
  }
  if (editorType === "managedImage" || editorType === "image") return imageProps(value);
  if ([
    "formulaBlock",
    "childPage",
    "pageLink",
    "referenceLink",
    "managedFile",
    "file",
  ].includes(editorType)) return {};
  return appProps(value);
}

function appBlockType(editorType: string, props: unknown): NoteBlockType {
  // Keep historical wire types at the codec boundary; the editor has one link renderer.
  if (editorType === "referenceLink") return asRecord(props).referenceType === "readingNoteReference"
    ? "readingNoteReference" : "researchObjectReference";
  if (editorType === "pageLink") return "researchObjectReference";
  if (editorType === "managedImage") return "image";
  if (editorType === "managedFile") return "file";
  if (editorType === "unsupportedBlock") return "unsupported";
  if (["paragraph", "heading", "bulletListItem", "numberedListItem", "checkListItem", "toggleListItem", "quote", "codeBlock", "divider", "table", "image", "file", "formulaBlock", "childPage"].includes(editorType)) {
    return editorType as NoteBlockType;
  }
  return "paragraph";
}

export function editorToBlocks(
  blocks: readonly PortableEditorBlock[],
  options: { readonly validChildPages?: readonly { readonly blockId: string; readonly targetId: string }[] } = {},
): readonly NoteBlockV1[] {
  const validChildPages = options.validChildPages === undefined
    ? undefined
    : new Map(options.validChildPages.map((child) => [child.targetId, child.blockId]));
  const seenChildPageIds = new Set<string>();
  const convert = (block: PortableEditorBlock): NoteBlockV1 => {
    const value = block as unknown as Record<string, unknown>;
    const editorType = String(value.type);
    const content = editorContent(block);
    let type = appBlockType(editorType, value.props);
    let pastedPageEntry = false;
    if (type === "childPage" && content.kind === "reference") {
      const isValidChild = validChildPages === undefined
        || validChildPages.get(content.targetId) === String(value.id);
      if (!isValidChild || seenChildPageIds.has(content.targetId)) {
        // A pasted page entrance retains its lifecycle identity even when the
        // clipboard regenerates the block ID. It is not an ordinary @/link.
        type = "researchObjectReference";
        pastedPageEntry = true;
      }
      else seenChildPageIds.add(content.targetId);
    }
    return {
      id: noteBlockId(String(value.id)),
      type,
      props: { ...domainProps(editorType, value.props), ...(pastedPageEntry ? {pageEntry:true} : {}) },
      content,
      children: Array.isArray(value.children) ? (value.children as PortableEditorBlock[]).map(convert) : [],
    };
  };
  return decodeNoteBlocks(blocks.map(convert));
}
