import type { WritingDocumentSnapshot } from "./documentContent";
import { parseManuscriptPath } from "./manuscriptPath";

export interface WritingDocumentOperation {
  readonly operationId: string;
  readonly conversationId: string;
  readonly requestId: string;
  readonly resultSha256: string;
}

/** Last strictly observed dispatch, independent of subsequent D/B or process identity. */
export interface WritingDocumentEditorReceipt {
  readonly operationId: string;
  readonly sessionId: string;
  readonly revision: string;
  readonly text: string;
  /** File version observed at dispatch; absent in legacy receipt records. */
  readonly stateVersion?: number;
}

/** Retained until the formal file's actual hash has been reconciled. */
export interface WritingDocumentSaveIntent {
  readonly operationId: string;
  readonly version: number;
  readonly expectedSha256: string;
  readonly targetSha256: string;
}

/** D/B are one recovery record. This is not a second authoritative source file. */
export interface WritingDocumentCheckpoint extends WritingDocumentSnapshot {
  readonly schemaVersion: 1;
  readonly savedSha256: string;
  readonly savedVersion: number;
  readonly operations: readonly WritingDocumentOperation[];
  readonly saveIntent: WritingDocumentSaveIntent | null;
  /** Absent in legacy checkpoints. Missing evidence never authorizes replay. */
  readonly editorReceipt?: WritingDocumentEditorReceipt;
}

export interface WritingCheckpointRecord {
  readonly revision: number;
  readonly checkpoint: WritingDocumentCheckpoint;
}

/** null creates a record; later writes compare the storage revision, not only D's version. */
export interface WritingCheckpointWrite {
  readonly expectedRevision: number | null;
  readonly checkpoint: WritingDocumentCheckpoint;
}

function invalid(): never { throw new Error("无效的写作文件检查点"); }
function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
function fields(input: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(input).some((key) => !allowed.includes(key))) invalid();
}
function version(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) invalid();
  return value;
}
function identity(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 256 || [...value].length > 128 || /[\u0000-\u001f\ud800-\udfff]/u.test(value)) invalid();
  return value;
}
function hash(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) invalid();
  return value;
}
function utf8Length(value: string, limit: number): number {
  let bytes = 0;
  for (const character of value) {
    const code = character.codePointAt(0) ?? invalid();
    if (code >= 0xd800 && code <= 0xdfff) invalid();
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
    if (bytes > limit) invalid();
  }
  return bytes;
}
function text(value: unknown): string {
  if (typeof value !== "string") invalid();
  utf8Length(value, 8 * 1024 * 1024);
  return value;
}

export function decodeWritingDocumentCheckpoint(value: unknown): WritingDocumentCheckpoint {
  const input = record(value);
  fields(input, ["schemaVersion", "manuscriptId", "relativePath", "version", "content", "reviewBaseline", "savedSha256", "savedVersion", "operations", "saveIntent", "editorReceipt"]);
  if (input.schemaVersion !== 1 || !Array.isArray(input.operations)) invalid();
  const currentVersion = version(input.version);
  const savedVersion = version(input.savedVersion);
  if (savedVersion > currentVersion || typeof input.relativePath !== "string") invalid();
  const relativePath = parseManuscriptPath(input.relativePath);
  utf8Length(relativePath, 1024);
  if (relativePath.split("/").some((segment) => /^\.agent-(?:before|create)-/iu.test(segment))) invalid();
  const seen = new Set<string>();
  const operations = input.operations.map((value): WritingDocumentOperation => {
    const operation = record(value), operationId = identity(operation.operationId);
    fields(operation, ["operationId", "conversationId", "requestId", "resultSha256"]);
    if (seen.has(operationId)) invalid();
    seen.add(operationId);
    return { operationId, conversationId: identity(operation.conversationId),
      requestId: identity(operation.requestId), resultSha256: hash(operation.resultSha256) };
  });
  let saveIntent: WritingDocumentSaveIntent | null = null;
  if (input.saveIntent !== null) {
    const intent = record(input.saveIntent), intentVersion = version(intent.version);
    fields(intent, ["operationId", "version", "expectedSha256", "targetSha256"]);
    if (intentVersion > currentVersion || intentVersion < savedVersion) invalid();
    saveIntent = { operationId: identity(intent.operationId), version: intentVersion,
      expectedSha256: hash(intent.expectedSha256), targetSha256: hash(intent.targetSha256) };
  }
  let editorReceipt: WritingDocumentEditorReceipt | undefined;
  if (input.editorReceipt !== undefined) {
    const receipt = record(input.editorReceipt);
    fields(receipt, ["operationId", "sessionId", "revision", "text", "stateVersion"]);
    const stateVersion = receipt.stateVersion === undefined ? undefined : version(receipt.stateVersion);
    if (stateVersion !== undefined && stateVersion > currentVersion) invalid();
    editorReceipt = { operationId: identity(receipt.operationId), sessionId: identity(receipt.sessionId),
      revision: identity(receipt.revision), text: text(receipt.text), ...(stateVersion !== undefined ? { stateVersion } : {}) };
    if (!seen.has(editorReceipt.operationId)) invalid();
  }
  return { schemaVersion: 1, manuscriptId: identity(input.manuscriptId), relativePath,
    version: currentVersion, content: text(input.content), reviewBaseline: text(input.reviewBaseline),
    savedSha256: hash(input.savedSha256), savedVersion, operations, saveIntent,
    ...(editorReceipt ? { editorReceipt } : {}) };
}

function receiptAdvances(previous: WritingDocumentCheckpoint, next: WritingDocumentCheckpoint): boolean {
  if (!previous.editorReceipt) return true;
  if (JSON.stringify(previous.editorReceipt) === JSON.stringify(next.editorReceipt)) return true;
  // A new dispatch may replace the bounded last receipt; old observations cannot be rewritten or removed.
  return next.editorReceipt !== undefined && next.operations.slice(previous.operations.length)
    .some((operation) => operation.operationId === next.editorReceipt?.operationId);
}

export function decodeWritingCheckpointRecord(value: unknown): WritingCheckpointRecord {
  const input = record(value), revision = version(input.revision);
  if (revision === 0) invalid();
  return { revision, checkpoint: decodeWritingDocumentCheckpoint(input.checkpoint) };
}

/** The same compare-and-swap semantics used by native storage and mock gateways. */
export function advanceWritingCheckpoint(current: WritingCheckpointRecord | undefined, write: WritingCheckpointWrite): WritingCheckpointRecord {
  if (current) current = decodeWritingCheckpointRecord(current);
  const next = decodeWritingDocumentCheckpoint(write.checkpoint);
  if (write.expectedRevision !== null && version(write.expectedRevision) === 0) invalid();
  const previous = current?.checkpoint;
  if (previous && JSON.stringify(previous) === JSON.stringify(next)) return decodeWritingCheckpointRecord(current);
  const conflict = current?.revision !== (write.expectedRevision ?? undefined)
    || (previous !== undefined && (next.manuscriptId !== previous.manuscriptId || next.relativePath !== previous.relativePath
      || next.version < previous.version || next.savedVersion < previous.savedVersion
      || previous.operations.some((operation, index) => JSON.stringify(next.operations[index]) !== JSON.stringify(operation))
      || !receiptAdvances(previous, next)
      || (next.version === previous.version && (next.content !== previous.content || next.reviewBaseline !== previous.reviewBaseline))));
  if (conflict || current?.revision === Number.MAX_SAFE_INTEGER) {
    throw Object.assign(new Error("写作文件检查点已变化，请重新核对当前版本"), { code: "checkpoint_conflict" });
  }
  return { revision: (current?.revision ?? 0) + 1, checkpoint: next };
}
