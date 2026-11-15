import type { AgentModelIdentity } from "./events";
import { decodeAgentSubmissionPreview, type AgentSubmissionPreview, type AgentWritingPrepareRequest } from "./submission";

/** Host disclosure scope accepted by native compaction_commands::StartRequest. */
export type AgentCompactionHost =
  | { readonly kind: "manuscript"; readonly manuscriptId: string }
  | { readonly kind: "paper"; readonly paperId: string; readonly paperContextSnapshotId: string }
  | { readonly kind: "note"; readonly pageId: string }
  | { readonly kind: "readingNote"; readonly readingNoteId: string };

/** Admission of a frozen command, not a completed or installed window. */
export interface AgentCompactionStartRequest {
  readonly conversationId: string;
  readonly requestId: string;
  readonly contextSnapshotId: string;
  readonly expectedRevision: number;
  readonly model: AgentModelIdentity;
  readonly host: AgentCompactionHost;
}

/** The history disclosure boundary is captured once, alongside the submission. */
export interface AgentWritingCompactionPrepareRequest {
  readonly request: AgentWritingPrepareRequest;
  readonly expectedRevision: number;
}
export interface AgentWritingCompactionPreview {
  readonly preview: AgentSubmissionPreview;
  readonly expectedRevision: number;
}

export class AgentCompactionDecodeError extends Error {
  constructor() { super("Invalid or unsupported agent compaction request"); this.name = "AgentCompactionDecodeError"; }
}
function fail(): never { throw new AgentCompactionDecodeError(); }
function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : fail();
}
function fields(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const row = object(value);
  if (Object.keys(row).length !== keys.length || keys.some(key => !Object.hasOwn(row, key))) return fail();
  return row;
}
function text(value: unknown): string { return typeof value === "string" ? value : fail(); }
function revision(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : fail();
}

/** Match UUID's native serde forms; normalize only identity spelling. */
function uuid(value: unknown, nonNil: boolean): string {
  let source = text(value);
  if (source.startsWith("urn:uuid:")) source = source.slice(9);
  else if (source.startsWith("{") && source.endsWith("}")) source = source.slice(1, -1);
  if (/^[\da-f]{32}$/iu.test(source)) source = `${source.slice(0, 8)}-${source.slice(8, 12)}-${source.slice(12, 16)}-${source.slice(16, 20)}-${source.slice(20)}`;
  if (!/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/iu.test(source)) return fail();
  source = source.toLowerCase();
  if (nonNil && source === "00000000-0000-0000-0000-000000000000") return fail();
  return source;
}
function host(value: unknown): AgentCompactionHost {
  const row = object(value);
  switch (row.kind) {
    case "manuscript": {
      fields(row, ["kind", "manuscriptId"]);
      return { kind: row.kind, manuscriptId: uuid(row.manuscriptId, false) };
    }
    case "paper": {
      fields(row, ["kind", "paperId", "paperContextSnapshotId"]);
      return { kind: row.kind, paperId: text(row.paperId), paperContextSnapshotId: text(row.paperContextSnapshotId) };
    }
    case "note": {
      fields(row, ["kind", "pageId"]);
      return { kind: row.kind, pageId: uuid(row.pageId, false) };
    }
    case "readingNote": {
      fields(row, ["kind", "readingNoteId"]);
      return { kind: row.kind, readingNoteId: uuid(row.readingNoteId, false) };
    }
    default: return fail();
  }
}

export function decodeAgentCompactionStartRequest(value: unknown): AgentCompactionStartRequest {
  const row = fields(value, ["conversationId", "requestId", "contextSnapshotId", "expectedRevision", "model", "host"]);
  // Native ModelIdentity accepts arbitrary string identities and ignores unknown
  // fields. Policy and exact frozen-model confirmation remain native decisions.
  const model = object(row.model);
  return {
    conversationId: uuid(row.conversationId, true),
    requestId: uuid(row.requestId, true),
    contextSnapshotId: uuid(row.contextSnapshotId, true),
    expectedRevision: revision(row.expectedRevision),
    model: { providerId: text(model.providerId), modelId: text(model.modelId), revision: model.revision == null ? null : text(model.revision) },
    host: host(row.host),
  };
}

export function decodeAgentWritingCompactionPreview(value: unknown): AgentWritingCompactionPreview {
  const row = fields(value, ["preview", "expectedRevision"]);
  return { preview: decodeAgentSubmissionPreview(row.preview), expectedRevision: revision(row.expectedRevision) };
}

/** Start only the returned immutable snapshot/model/history boundary. Current
 * editor contents, selected model and live history are not confirmation input. */
export function agentWritingCompactionStartRequest(value: AgentWritingCompactionPreview): AgentCompactionStartRequest {
  const { preview, expectedRevision } = decodeAgentWritingCompactionPreview(value);
  if (preview.input.text.trim() !== "/compact") return fail();
  return decodeAgentCompactionStartRequest({
    conversationId: preview.conversationId,
    requestId: preview.requestId,
    contextSnapshotId: preview.contextSnapshotId,
    expectedRevision,
    model: preview.input.model,
    host: { kind: "manuscript", manuscriptId: preview.manuscriptId },
  });
}
