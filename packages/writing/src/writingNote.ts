import { decodeNoteBlocks, noteBlockId, type NoteBlockV1 } from "@research-assistant/core/notes";
import { parseManuscriptPath } from "./manuscriptPath";

export interface WritingNoteFileV1 {
  readonly schemaVersion: 1;
  readonly noteId: string;
  readonly blocks: readonly NoteBlockV1[];
}
export interface WritingNoteAsset {
  readonly assetId: string;
  readonly displayName: string;
  readonly mimeType: string;
}
export const MAX_WRITING_NOTE_ASSET_BYTES = 16 * 1024 * 1024;
export function isWritingNotePath(path: string | undefined): boolean {
  return path?.toLowerCase().endsWith(".ranote") === true;
}
export function isWritingNoteAssetPath(path: string): boolean {
  return path === ".ranote-assets" || path.startsWith(".ranote-assets/");
}
export function isWritingSourcePath(path: string): boolean {
  return !isWritingNotePath(path) && !isWritingNoteAssetPath(path);
}
export function writingNoteTitle(path: string): string {
  return (path.split("/").at(-1) ?? path).replace(/\.ranote$/i, "");
}
export function writingNotePath(title: string): string {
  if (!title.trim() || /[/\\]/.test(title)) throw new Error("笔记名称不能包含路径分隔符");
  return parseManuscriptPath("notes/" + title.trim().replace(/\.ranote$/i, "") + ".ranote");
}
export function createWritingNote(noteId: string, blockId: string, title?: string): WritingNoteFileV1 {
  return { schemaVersion: 1, noteId, blocks: [{ id: noteBlockId(blockId), type: title === undefined ? "paragraph" : "heading", props: title === undefined ? {} : { level: 1 }, content: { kind: "inline", items: title === undefined ? [] : [{ type: "text", text: title, styles: [] }] }, children: [] }] };
}
export function decodeWritingNote(content: string): WritingNoteFileV1 {
  return decodeWritingNoteValue(JSON.parse(content) as unknown);
}
/** Validate an already parsed file without allocating a second JSON tree. */
export function decodeWritingNoteValue(value: unknown): WritingNoteFileV1 {
  if (typeof value !== "object" || value === null) throw new Error("笔记文件无效");
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== 1 || typeof record.noteId !== "string" || !record.noteId || record.noteId.length > 128) throw new Error("不支持的写作笔记版本或标识");
  const blocks = decodeNoteBlocks(record.blocks);
  const visit = (block: NoteBlockV1): void => {
    if (["childPage", "readingNoteReference", "researchObjectReference", "unsupported"].includes(block.type)
      || block.content.kind === "reference" || block.content.kind === "unsupported") throw new Error("写作笔记包含不支持的块");
    const content = block.content;
    if (content.kind === "inline" && content.items.some((item) => item.type === "mention")) throw new Error("写作笔记不支持科研提及");
    if (content.kind === "table" && content.rows.some((row) => row.some((cell) => cell.items.some((item) => item.type === "mention")))) throw new Error("写作笔记不支持科研提及");
    if (content.kind === "asset" && !/^[a-zA-Z0-9-]{1,128}$/.test(content.assetId)) throw new Error("笔记资源标识无效");
    block.children.forEach(visit);
  };
  blocks.forEach(visit);
  return { schemaVersion: 1, noteId: record.noteId, blocks };
}
