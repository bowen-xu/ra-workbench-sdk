import type { AgentWorkspaceConfirmation } from "./workspace";
import { AgentWorkspaceDecodeError, row, id, validPath, utf8Length } from "./workspaceDecoding";

export interface AgentFileVersion { readonly sha256: string; readonly byteSize: number; readonly executable: boolean }
export interface AgentWorkspaceChange {
  readonly path: string;
  readonly kind: "added" | "modified" | "deleted";
  readonly before: AgentFileVersion | null;
  readonly after: AgentFileVersion | null;
  readonly hasEditorBuffer: boolean;
}
export interface AgentWorkspaceReview {
  readonly schemaVersion: 1;
  readonly binding: AgentWorkspaceConfirmation;
  readonly changes: readonly AgentWorkspaceChange[];
}
export type AgentReviewContent = { readonly kind: "text"; readonly text: string } | { readonly kind: "binary" | "tooLarge" };
export interface AgentWorkspaceFileReview {
  readonly schemaVersion: 1;
  readonly binding: AgentWorkspaceConfirmation;
  readonly change: AgentWorkspaceChange;
  readonly before: AgentReviewContent | null;
  readonly after: AgentReviewContent | null;
}
export interface AgentWorkspaceFileRequest {
  readonly binding: AgentWorkspaceConfirmation;
  readonly path: string;
  readonly before: AgentFileVersion | null;
  readonly after: AgentFileVersion | null;
}
function hash(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) throw new AgentWorkspaceDecodeError();
  return value;
}
export function decodeAgentWorkspaceConfirmation(value: unknown): AgentWorkspaceConfirmation {
  const record = row(value, ["scope", "turnId", "leaseId", "manifestHash"]);
  const scope = row(record.scope, ["conversationId", "requestId", "manuscriptId", "contextSnapshotId"]);
  return { scope: { conversationId: id(scope.conversationId), requestId: id(scope.requestId), manuscriptId: id(scope.manuscriptId), contextSnapshotId: id(scope.contextSnapshotId) },
    turnId: id(record.turnId), leaseId: id(record.leaseId), manifestHash: hash(record.manifestHash) };
}
function version(value: unknown): AgentFileVersion | null {
  if (value === null) return null;
  const record = row(value, ["sha256", "byteSize", "executable"]);
  if (typeof record.byteSize !== "number" || !Number.isSafeInteger(record.byteSize) || record.byteSize < 0
    || record.byteSize > 256 * 1024 * 1024 || typeof record.executable !== "boolean") throw new AgentWorkspaceDecodeError();
  return { sha256: hash(record.sha256), byteSize: record.byteSize, executable: record.executable };
}
function change(value: unknown): AgentWorkspaceChange {
  const record = row(value, ["path", "kind", "before", "after", "hasEditorBuffer"]);
  if (typeof record.path !== "string" || !validPath(record.path) || typeof record.hasEditorBuffer !== "boolean") throw new AgentWorkspaceDecodeError();
  const before = version(record.before); const after = version(record.after);
  if (record.kind === "added" ? before !== null || after === null || record.hasEditorBuffer
    : record.kind === "deleted" ? before === null || after !== null
    : record.kind === "modified" ? before === null || after === null || (before.sha256 === after.sha256 && before.byteSize === after.byteSize && before.executable === after.executable)
    : true) throw new AgentWorkspaceDecodeError();
  return { path: record.path, kind: record.kind as AgentWorkspaceChange["kind"], before, after, hasEditorBuffer: record.hasEditorBuffer };
}
function content(value: unknown, version: AgentFileVersion | null): AgentReviewContent | null {
  if (version === null) { if (value !== null) throw new AgentWorkspaceDecodeError(); return null; }
  if (!value || typeof value !== "object" || !("kind" in value)) throw new AgentWorkspaceDecodeError();
  const record = row(value, value.kind === "text" ? ["kind", "text"] : ["kind"]);
  if (record.kind === "text") {
    if (typeof record.text !== "string" || record.text.length > 1024 * 1024 || record.text.includes("\0")
      || version.byteSize > 1024 * 1024 || utf8Length(record.text) !== version.byteSize) throw new AgentWorkspaceDecodeError();
    return { kind: "text", text: record.text };
  }
  if (record.kind === "tooLarge" && version.byteSize > 1024 * 1024) return { kind: "tooLarge" };
  if (record.kind === "binary" && version.byteSize > 0 && version.byteSize <= 1024 * 1024) return { kind: "binary" };
  throw new AgentWorkspaceDecodeError();
}
export function decodeAgentWorkspaceReview(value: unknown): AgentWorkspaceReview {
  const record = row(value, ["schemaVersion", "binding", "changes"]);
  if (record.schemaVersion !== 1 || !Array.isArray(record.changes) || record.changes.length > 20000) throw new AgentWorkspaceDecodeError();
  const changes = record.changes.map(change);
  const paths = new Set<string>(); let beforeBytes = 0; let afterBytes = 0; let beforeFiles = 0; let afterFiles = 0;
  for (const entry of changes) {
    if (paths.has(entry.path)) throw new AgentWorkspaceDecodeError();
    paths.add(entry.path); beforeBytes += entry.before?.byteSize ?? 0; afterBytes += entry.after?.byteSize ?? 0;
    if (entry.before) beforeFiles++; if (entry.after) afterFiles++;
  }
  if (beforeBytes > 512 * 1024 * 1024 || afterBytes > 512 * 1024 * 1024 || beforeFiles > 10000 || afterFiles > 10000) throw new AgentWorkspaceDecodeError();
  return { schemaVersion: 1, binding: decodeAgentWorkspaceConfirmation(record.binding), changes };
}
export function decodeAgentWorkspaceFileReview(value: unknown): AgentWorkspaceFileReview {
  const record = row(value, ["schemaVersion", "binding", "change", "before", "after"]);
  if (record.schemaVersion !== 1) throw new AgentWorkspaceDecodeError();
  const file = change(record.change);
  return { schemaVersion: 1, binding: decodeAgentWorkspaceConfirmation(record.binding), change: file,
    before: content(record.before, file.before), after: content(record.after, file.after) };
}
