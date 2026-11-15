import {noteDocumentPlainText, type NoteDocumentV1, type NoteBlockV1} from "./document";

/** Blank text and formatting-only changes do not publish a new page. A
 * deliberate media/table/reference/divider insertion is meaningful content. */
export function hasNoteDraftContent(document: NoteDocumentV1): boolean {
  const structural = (block: NoteBlockV1): boolean => block.content.kind !== "inline"
    || block.type === "divider" || block.children.some(structural);
  return !!document.title?.trim() || !!noteDocumentPlainText(document).trim() || document.blocks.some(structural);
}
