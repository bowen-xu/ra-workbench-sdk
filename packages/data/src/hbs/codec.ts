import type { HbsSnapshot as ModelSnapshot, HbsUnit as Paragraph, ParagraphPatch, TextPatch } from "@research-assistant/core/hbs";

export type CommitRequest = { readonly id: string; readonly expectedVersion: number } & (
  { readonly encoding: "patch"; readonly patches: readonly ParagraphPatch[] } | { readonly encoding: "snapshot"; readonly snapshot: ModelSnapshot });
export interface CommitReceipt { readonly requestId: string; readonly version: number }
export type ClientMessage = { readonly type: "read"; readonly id: string }
  | { readonly type: "sync"; readonly id: string; readonly knownVersion: number }
  | (CommitRequest & { readonly type: "commit" });
export type ServerMessage = { readonly type: "snapshot"; readonly requestId: string; readonly snapshot: ModelSnapshot }
  | ({ readonly type: "receipt" } & CommitReceipt)
  | ({ readonly type: "unchanged" } & CommitReceipt)
  | { readonly type: "rejection"; readonly requestId: string; readonly snapshot: ModelSnapshot; readonly error: string };

const invalid = (): never => { throw new Error("MODEL_PROTOCOL_ERROR：消息结构、标识或数值无效。"); };
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : invalid();
}
function keys(value: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) invalid();
}
function text(value: unknown, max = 12_000): string { return typeof value === "string" && value.length <= max ? value : invalid(); }
function id(value: unknown): string { const result = text(value, 256); return result.length ? result : invalid(); }
function integer(value: unknown, min = 0): number { return typeof value === "number" && Number.isSafeInteger(value) && value >= min ? value : invalid(); }
function list<T>(value: unknown, decode: (item: unknown) => T): T[] {
  return Array.isArray(value) && value.length <= 12_000 ? value.map(decode) : invalid();
}
function textPatch(value: unknown): TextPatch {
  const item = record(value); keys(item, ["from", "to", "insert"]);
  const patch = { from: integer(item.from), to: integer(item.to), insert: text(item.insert) };
  if (patch.to < patch.from || patch.to > 12_000 || patch.from === patch.to && !patch.insert.length) invalid();
  return patch;
}
function patches(value: unknown): ParagraphPatch[] {
  const ids = new Set<string>();
  return list(value, value => {
    const item = record(value); keys(item, ["id", "saved", "baseline"]);
    const result: ParagraphPatch = { id: id(item.id),
      ...(item.saved === undefined ? {} : { saved: list(item.saved, textPatch) }),
      ...(item.baseline === undefined ? {} : { baseline: list(item.baseline, textPatch) }) };
    if (ids.has(result.id) || !(result.saved?.length || result.baseline?.length)) invalid();
    ids.add(result.id); return result;
  });
}
export function decodeHbsSnapshot(value: unknown): ModelSnapshot {
  const item = record(value); keys(item, ["version", "saved", "baseline"]);
  const paragraphs = (value: unknown): Paragraph[] => {
    const ids = new Set<string>();
    return list(value, value => {
      const item = record(value); keys(item, ["id", "label", "text"]);
      const result = { id: id(item.id), label: text(item.label, 256), text: text(item.text) };
      if (ids.has(result.id)) invalid(); ids.add(result.id); return result;
    });
  };
  const result = { version: integer(item.version, 1), saved: paragraphs(item.saved), baseline: paragraphs(item.baseline) };
  const confirmed = new Set(result.baseline.map(item => item.id));
  if (result.saved.length !== confirmed.size || result.saved.some(item => !confirmed.has(item.id))) invalid();
  return result;
}
function parse(wire: string): Record<string, unknown> {
  try { return record(JSON.parse(wire) as unknown); } catch { return invalid(); }
}
export function decodeClientMessage(wire: string): ClientMessage {
  const item = parse(wire), requestId = id(item.id);
  if (item.type === "read") { keys(item, ["type", "id"]); return { type: "read", id: requestId }; }
  if (item.type === "sync") {
    keys(item, ["type", "id", "knownVersion"]);
    return { type: "sync", id: requestId, knownVersion: integer(item.knownVersion, 1) };
  }
  if (item.type !== "commit") return invalid();
  if (item.encoding === "snapshot") {
    keys(item, ["type", "id", "expectedVersion", "encoding", "snapshot"]);
    return { type: "commit", id: requestId, expectedVersion: integer(item.expectedVersion, 1), encoding: "snapshot", snapshot: decodeHbsSnapshot(item.snapshot) };
  }
  keys(item, ["type", "id", "expectedVersion", "encoding", "patches"]);
  if (item.encoding !== "patch") invalid();
  const changes = patches(item.patches); if (!changes.length) invalid();
  return { type: "commit", id: requestId, expectedVersion: integer(item.expectedVersion, 1), encoding: "patch", patches: changes };
}
export function decodeServerMessage(wire: string): ServerMessage {
  const item = parse(wire);
  const requestId = id(item.requestId);
  if (item.type === "receipt" || item.type === "unchanged") {
    keys(item, ["type", "requestId", "version"]);
    return { type: item.type, requestId, version: integer(item.version, 1) };
  }
  if (item.type === "snapshot") {
    keys(item, ["type", "requestId", "snapshot"]);
    return { type: "snapshot", requestId, snapshot: decodeHbsSnapshot(item.snapshot) };
  }
  if (item.type === "rejection") {
    keys(item, ["type", "requestId", "snapshot", "error"]);
    return { type: "rejection", requestId, snapshot: decodeHbsSnapshot(item.snapshot), error: text(item.error) };
  }
  return invalid();
}
