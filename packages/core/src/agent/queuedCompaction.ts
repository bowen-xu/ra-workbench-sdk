import { agentWritingCompactionStartRequest } from "./compaction";
import { decodeAgentWritingPrepareRequest } from "./queuePreviewPreparation";
import { decodeAgentWritingQueueCancelStatusResponse, type AgentWritingQueueCancelStatusResponse } from "./queuePreviewCancellation";
import {
  AgentSubmissionDecodeError, decodeAgentSubmissionPreview, decodeAgentWritingQueuePreview,
  decodeAgentWritingQueueResponse, type AgentSubmissionPreview, type AgentWritingPrepareRequest,
  type AgentWritingQueuePreviewResponse, type AgentWritingQueueResponse, type AgentWritingQueueScope,
} from "./submission";

export type AgentQueuedCompactionOutcome = "completed" | "failed" | "canceled" | "interrupted";
export type AgentWritingQueuedCompactionRetirement = AgentWritingQueueCancelStatusResponse & {
  readonly status: Extract<AgentWritingQueueCancelStatusResponse["status"], {readonly type: "committed"}>;
};

/** I is stable across attempts. A replacement R requires the original failed,
 * canceled or interrupted R; a transport failure never proves a replacement. */
export interface AgentWritingQueuedCompactionPrepareRequest {
  readonly inputId: string;
  readonly expectedQueueRevision: number;
  readonly previousRequestId: string | null;
  readonly submission: AgentWritingPrepareRequest;
  readonly expectedRevision: number;
}

export interface AgentWritingQueuedCompactionPreview {
  readonly schemaVersion: 1;
  readonly kind: "compact";
  readonly inputId: string;
  readonly requestId: string;
  /** Queue revision before this immutable claim, not the latest queue revision. */
  readonly claimRevision: number;
  readonly expectedRevision: number;
  readonly preview: AgentSubmissionPreview;
  readonly queue: AgentWritingQueueResponse;
  readonly outcome: AgentQueuedCompactionOutcome | null;
  /** Discovery recomputes whether I still refers to this R. Historical receipts
   * retain their original value and must not replace a newer queue snapshot. */
  readonly current: boolean;
  /** An exact durable unstarted cancellation, independently verified by Native.
   * Absent on ordinary preparations, running tasks and terminal settlements. */
  readonly retirement?: AgentWritingQueuedCompactionRetirement;
}

export interface AgentWritingQueuedCompactionReadRequest extends AgentWritingQueueScope {
  readonly inputId: string;
  /** null discovers the claim/latest retained attempt; R is an exact lookup. */
  readonly requestId: string | null;
}
export type AgentWritingQueuedCompactionReadResponse = AgentWritingQueuedCompactionPreview
  | { readonly schemaVersion: 1; readonly kind: "submission"; readonly preview: AgentWritingQueuePreviewResponse }
  | null;

export interface AgentWritingQueuedCompactionSettleRequest extends AgentWritingQueueScope {
  readonly operationId: string;
  readonly inputId: string;
  readonly requestId: string;
  readonly expectedQueueRevision: number;
  readonly claimRevision: number;
}
export interface AgentWritingQueuedCompactionSettleResponse {
  readonly schemaVersion: 1;
  readonly inputId: string;
  readonly requestId: string;
  readonly queue: AgentWritingQueueResponse;
  readonly outcome: AgentQueuedCompactionOutcome;
}

function fail(): never { throw new AgentSubmissionDecodeError(); }
function fields(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== keys.length || keys.some(key => !Object.hasOwn(row, key))) return fail();
  return row;
}
function id(value: unknown): string {
  if (typeof value !== "string") return fail();
  let source = value;
  if (source.startsWith("urn:uuid:")) source = source.slice(9);
  else if (source.startsWith("{") && source.endsWith("}")) source = source.slice(1, -1);
  if (/^[\da-f]{32}$/iu.test(source)) source = `${source.slice(0, 8)}-${source.slice(8, 12)}-${source.slice(12, 16)}-${source.slice(16, 20)}-${source.slice(20)}`;
  if (!/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/iu.test(source)) return fail();
  source = source.toLowerCase();
  return source === "00000000-0000-0000-0000-000000000000" ? fail() : source;
}
function revision(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : fail();
}
function claimRevision(value: unknown): number {
  const result = revision(value);
  return result < Number.MAX_SAFE_INTEGER ? result : fail();
}
function outcome(value: unknown): AgentQueuedCompactionOutcome {
  return value === "completed" || value === "failed" || value === "canceled" || value === "interrupted" ? value : fail();
}

/** Decode complete durable preparation intent before saving or replaying it.
 * Native still owns model policy, authorization and source materialization. */
export function decodeAgentWritingQueuedCompactionPrepareRequest(value: unknown): AgentWritingQueuedCompactionPrepareRequest {
  const row = fields(value, ["inputId", "expectedQueueRevision", "previousRequestId", "submission", "expectedRevision"]);
  return { inputId: id(row.inputId), expectedQueueRevision: claimRevision(row.expectedQueueRevision),
    previousRequestId: row.previousRequestId === null ? null : id(row.previousRequestId),
    submission: decodeAgentWritingPrepareRequest(row.submission), expectedRevision: revision(row.expectedRevision) };
}

export function decodeAgentWritingQueuedCompactionReadRequest(value: unknown): AgentWritingQueuedCompactionReadRequest {
  const row = fields(value, ["conversationId", "manuscriptId", "inputId", "requestId"]);
  return { conversationId: id(row.conversationId), manuscriptId: id(row.manuscriptId), inputId: id(row.inputId),
    requestId: row.requestId === null ? null : id(row.requestId) };
}
export function decodeAgentWritingQueuedCompactionSettleRequest(value: unknown): AgentWritingQueuedCompactionSettleRequest {
  const row = fields(value, ["operationId", "conversationId", "manuscriptId", "inputId", "requestId", "expectedQueueRevision", "claimRevision"]);
  return { operationId: id(row.operationId), conversationId: id(row.conversationId), manuscriptId: id(row.manuscriptId),
    inputId: id(row.inputId), requestId: id(row.requestId), expectedQueueRevision: claimRevision(row.expectedQueueRevision),
    claimRevision: claimRevision(row.claimRevision) };
}
export function decodeAgentWritingQueuedCompactionPreview(value: unknown): AgentWritingQueuedCompactionPreview {
  const hasRetirement = typeof value === "object" && value !== null && Object.hasOwn(value, "retirement");
  const row = fields(value, ["schemaVersion", "kind", "inputId", "requestId", "claimRevision", "expectedRevision", "preview", "queue", "outcome", "current", ...(hasRetirement ? ["retirement"] : [])]);
  if (row.schemaVersion !== 1 || row.kind !== "compact" || typeof row.current !== "boolean") return fail();
  const preview = decodeAgentSubmissionPreview(row.preview);
  const queue = decodeAgentWritingQueueResponse(row.queue);
  const requestId = id(row.requestId);
  const expectedRevision = revision(row.expectedRevision);
  const inputId = id(row.inputId), claim = claimRevision(row.claimRevision);
  agentWritingCompactionStartRequest({ preview, expectedRevision });
  if (requestId !== preview.requestId || preview.conversationId !== queue.conversationId
    || preview.manuscriptId !== queue.manuscriptId) return fail();
  let retirement: AgentWritingQueuedCompactionRetirement | undefined;
  if (hasRetirement) {
    const proof = decodeAgentWritingQueueCancelStatusResponse(row.retirement);
    if (proof.status.type !== "committed" || row.current || row.outcome !== null
      || proof.intent.conversationId !== preview.conversationId || proof.intent.manuscriptId !== preview.manuscriptId
      || proof.intent.inputId !== inputId || proof.intent.previewRequestId !== requestId
      || proof.intent.expectedRevision < claim + 1) return fail();
    retirement = {...proof, status: proof.status};
  }
  return { schemaVersion: 1, kind: "compact", inputId, requestId,
    claimRevision: claim, expectedRevision, preview, queue,
    outcome: row.outcome === null ? null : outcome(row.outcome), current: row.current,
    ...(retirement ? {retirement} : {}) };
}
export function decodeAgentWritingQueuedCompactionReadResponse(value: unknown): AgentWritingQueuedCompactionReadResponse {
  if (value === null) return null;
  if (typeof value === "object" && value !== null && "kind" in value && value.kind === "submission") {
    const row = fields(value, ["schemaVersion", "kind", "preview"]);
    if (row.schemaVersion !== 1) return fail();
    return { schemaVersion: 1, kind: "submission", preview: decodeAgentWritingQueuePreview(row.preview) };
  }
  return decodeAgentWritingQueuedCompactionPreview(value);
}
export function decodeAgentWritingQueuedCompactionSettleResponse(value: unknown): AgentWritingQueuedCompactionSettleResponse {
  const row = fields(value, ["schemaVersion", "inputId", "requestId", "queue", "outcome"]);
  if (row.schemaVersion !== 1) return fail();
  return { schemaVersion: 1, inputId: id(row.inputId), requestId: id(row.requestId),
    queue: decodeAgentWritingQueueResponse(row.queue), outcome: outcome(row.outcome) };
}
