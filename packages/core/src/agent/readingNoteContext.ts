import { decodeAgentContextText } from "./submission";
import type { AgentNoteContextPreview } from "./noteContext";
import { id, row } from "./workspaceDecoding";

export interface AgentReadingNoteContextRequest { readonly readingNoteId: string; readonly expectedRevision: number; }
export function decodeAgentReadingNoteContextRequest(value: unknown): AgentReadingNoteContextRequest {
  const r = row(value, ["readingNoteId", "expectedRevision"]);
  if (typeof r.expectedRevision !== "number" || !Number.isSafeInteger(r.expectedRevision) || r.expectedRevision < 0) throw new Error("Invalid reading note revision");
  return {readingNoteId: id(r.readingNoteId), expectedRevision: r.expectedRevision};
}
/** Validate identities without replacing the native structured evidence bytes.
 * Reading-note evidence is deliberately distinct from a rewritable Note Page. */
export function decodeAgentReadingNoteContextPreview(value: unknown, expected: AgentReadingNoteContextRequest): AgentNoteContextPreview {
  const request = decodeAgentReadingNoteContextRequest(expected), r = row(value, ["schemaVersion", "source"]);
  const source = decodeAgentContextText(r.source);
  if (r.schemaVersion !== 1 || source.kind !== "note" || source.resourceId !== request.readingNoteId
    || source.sourceId !== `reading-note:${request.readingNoteId}` || source.anchor === null
    || !new RegExp(`^revision:${request.expectedRevision}:sha256:[0-9a-f]{64}$`).test(source.revision)) throw new Error("Mismatched reading note context");
  const content = row(JSON.parse(source.text), ["schemaVersion", "readingNoteId", "noteRevision", "noteType", "content", "source"]);
  const anchor = row(JSON.parse(source.anchor), ["schemaVersion", "readingNoteId", "noteRevision", "sourceAnchorId", "paperId", "attachmentId", "contentSha256", "pageIndex", "locatorVersion"]);
  const origin = row(content.source, ["anchorId", "paperId", "paperTitle", "attachmentId", "contentSha256", "pageIndex", "pageLabel", "rects", "quoteExact", "quotePrefix", "quoteSuffix", "selector", "locatorVersion"]);
  if (content.schemaVersion !== 1 || anchor.schemaVersion !== 1 || content.readingNoteId !== request.readingNoteId || anchor.readingNoteId !== request.readingNoteId
    || content.noteRevision !== request.expectedRevision || anchor.noteRevision !== request.expectedRevision
    || !["highlight", "annotation", "page_note"].includes(String(content.noteType))
    || !content.content || typeof content.content !== "object" || Array.isArray(content.content)
    || anchor.sourceAnchorId !== origin.anchorId || ["paperId", "attachmentId", "contentSha256", "pageIndex", "locatorVersion"].some(key => anchor[key] !== origin[key])
    || typeof origin.pageIndex !== "number" || !Number.isSafeInteger(origin.pageIndex) || origin.pageIndex < 0
    || typeof origin.contentSha256 !== "string" || !/^[0-9a-f]{64}$/.test(origin.contentSha256)
    || ["paperId", "paperTitle", "attachmentId", "quoteExact", "quotePrefix", "quoteSuffix"].some(key => typeof origin[key] !== "string")
    || !Array.isArray(origin.rects) || (origin.selector !== null && (typeof origin.selector !== "object" || Array.isArray(origin.selector)))
    || origin.locatorVersion !== (origin.selector === null ? 1 : 2)) throw new Error("Invalid reading note evidence");
  return {schemaVersion: 1, source};
}
