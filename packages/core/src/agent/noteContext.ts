import { decodeNoteDocument } from "../notes/document";
import { decodeAgentContextText, type AgentContextText } from "./submission";

export interface AgentNoteContextRequest {
  readonly pageId: string;
  readonly expectedRevision: number;
  readonly blockId?: string | null;
}
export interface AgentNoteContextPreview {
  readonly schemaVersion: 1;
  readonly source: AgentContextText;
}
export class AgentNoteContextDecodeError extends Error {
  constructor() { super("Invalid or mismatched note context preview"); this.name = "AgentNoteContextDecodeError"; }
}
function fail(): never { throw new AgentNoteContextDecodeError(); }
function row(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const object = value as Record<string, unknown>;
  if (Object.keys(object).length !== keys.length || keys.some(key => !Object.hasOwn(object, key))) return fail();
  return object;
}
function id(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)
    || value === "00000000-0000-0000-0000-000000000000") return fail();
  return value.toLowerCase();
}
function revision(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : fail();
}
function blockId(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !value.trim() || value.includes("\0")) return fail();
  let bytes = 0;
  for (const character of value) {
    const code = character.codePointAt(0);
    if (code === undefined || (code >= 0xd800 && code <= 0xdfff)) return fail();
    bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
    if (bytes > 128) return fail();
  }
  return value;
}

/** Freeze the explicit local selection; no inferred expansion from a page link. */
export function decodeAgentNoteContextRequest(value: unknown): AgentNoteContextRequest {
  const optional = !!value && typeof value === "object" && Object.hasOwn(value, "blockId");
  const request = row(value, ["pageId", "expectedRevision", ...(optional ? ["blockId"] : [])]);
  return { pageId: id(request.pageId), expectedRevision: revision(request.expectedRevision), blockId: optional && request.blockId !== undefined ? blockId(request.blockId) : null };
}

/** Keep exact native evidence bytes; parsed content is checked, never rewritten. */
export function decodeAgentNoteContextPreview(value: unknown, expected: AgentNoteContextRequest): AgentNoteContextPreview {
  try {
    const request = decodeAgentNoteContextRequest(expected);
    const preview = row(value, ["schemaVersion", "source"]);
    if (preview.schemaVersion !== 1) return fail();
    const source = decodeAgentContextText(preview.source);
    if (source.kind !== "note" || source.resourceId !== request.pageId || !/^note:[0-9a-f]{64}$/.test(source.sourceId)
      || !new RegExp(`^revision:${request.expectedRevision}:sha256:[0-9a-f]{64}$`).test(source.revision)
      || source.anchor === null) return fail();
    const anchor = row(JSON.parse(source.anchor), ["schemaVersion", "pageId", "pageRevision", "blockId"]);
    if (anchor.schemaVersion !== 1 || anchor.pageId !== request.pageId || anchor.pageRevision !== request.expectedRevision
      || anchor.blockId !== request.blockId) return fail();
    const content = row(JSON.parse(source.text), ["schemaVersion", "pageId", "title", "pageRevision", "blocks"]);
    if (content.schemaVersion !== 1 || content.pageId !== request.pageId || content.pageRevision !== request.expectedRevision
      || typeof content.title !== "string") return fail();
    const document = decodeNoteDocument({ schemaVersion: 1, pageId: content.pageId, blocks: content.blocks });
    if (request.blockId !== null && (document.blocks.length !== 1 || document.blocks[0]?.id !== request.blockId)) return fail();
    return { schemaVersion: 1, source };
  } catch { return fail(); }
}
