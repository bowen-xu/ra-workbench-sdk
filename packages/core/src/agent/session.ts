import { decodeAgentEvent, type AgentEvent } from "./events";
export interface AgentSessionResponse { readonly schemaVersion: 1; readonly conversationId: string; readonly watermark: number }
export interface AgentHistoryResponse extends AgentSessionResponse {
  readonly afterSeq: number;
  readonly events: readonly AgentEvent[];
  readonly nextAfterSeq: number | null;
  readonly snapshotId?: string;
}
export interface AgentHistoryRequest { readonly conversationId: string; readonly afterSeq: number; readonly limit: number; readonly snapshotId?: string }
export class AgentSessionDecodeError extends Error {
  constructor() { super("Invalid or unsupported agent session response"); this.name = "AgentSessionDecodeError"; }
}
function object(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !fields.includes(key))) throw new AgentSessionDecodeError();
  return value as Record<string, unknown>;
}
function identity(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)) throw new AgentSessionDecodeError();
  return value.toLowerCase();
}
function integer(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new AgentSessionDecodeError();
  return value;
}
function base(row: Record<string, unknown>): AgentSessionResponse {
  if (row.schemaVersion !== 1) throw new AgentSessionDecodeError();
  return { schemaVersion: 1, conversationId: identity(row.conversationId), watermark: integer(row.watermark) };
}
export function decodeAgentSessionResponse(value: unknown): AgentSessionResponse {
  return base(object(value, ["schemaVersion", "conversationId", "watermark"]));
}
export function decodeAgentHistoryResponse(value: unknown): AgentHistoryResponse {
  const row = object(value, ["schemaVersion", "conversationId", "watermark", "afterSeq", "events", "nextAfterSeq", "snapshotId"]);
  const session = base(row);
  const afterSeq = integer(row.afterSeq);
  if (afterSeq > session.watermark || !Array.isArray(row.events) || row.events.length > 500) throw new AgentSessionDecodeError();
  const events = row.events.map(decodeAgentEvent);
  const lastSeq = afterSeq + events.length;
  if (lastSeq > session.watermark || events.some((event, index) => event.conversationId !== session.conversationId || event.seq !== afterSeq + index + 1)) throw new AgentSessionDecodeError();
  const nextAfterSeq = row.nextAfterSeq === null ? null : integer(row.nextAfterSeq);
  if (lastSeq < session.watermark ? events.length === 0 || nextAfterSeq !== lastSeq : nextAfterSeq !== null) throw new AgentSessionDecodeError();
  const snapshotId = row.snapshotId === undefined ? undefined : identity(row.snapshotId);
  if (snapshotId === "00000000-0000-0000-0000-000000000000") throw new AgentSessionDecodeError();
  return { ...session, afterSeq, events, nextAfterSeq, ...(snapshotId === undefined ? {} : { snapshotId }) };
}

export interface AgentHistoryWaitRequest { readonly conversationId: string; readonly afterSeq: number; readonly waitMs: number }
export interface AgentHistoryWaitResponse {
  readonly schemaVersion: 1; readonly conversationId: string; readonly afterSeq: number; readonly watermark: number | null;
  /** Present for the native accepted-event path. Legacy mock gateways omit it. */
  readonly events?: readonly AgentEvent[];
  readonly resyncRequired?: boolean;
}
export function decodeAgentHistoryWaitResponse(value: unknown): AgentHistoryWaitResponse {
  const row = object(value, ["schemaVersion", "conversationId", "afterSeq", "watermark", "events", "resyncRequired"]);
  if (row.schemaVersion !== 1) throw new AgentSessionDecodeError();
  const afterSeq = integer(row.afterSeq);
  const watermark = row.watermark === null ? null : integer(row.watermark);
  const conversationId = identity(row.conversationId);
  if (row.resyncRequired !== undefined && typeof row.resyncRequired !== "boolean") throw new AgentSessionDecodeError();
  if (row.events !== undefined && (!Array.isArray(row.events) || row.events.length > 500)) throw new AgentSessionDecodeError();
  const events = row.events === undefined ? undefined : (row.events as unknown[]).map(decodeAgentEvent);
  if (row.resyncRequired === true && events?.length) throw new AgentSessionDecodeError();
  if (events?.some((event, index) => event.conversationId !== conversationId || event.seq !== afterSeq + index + 1)
    || (events?.length && (watermark === null || afterSeq + events.length > watermark))
    || (events !== undefined && row.resyncRequired !== true && watermark !== null && events.length === 0)) throw new AgentSessionDecodeError();
  if (watermark !== null && watermark <= afterSeq) throw new AgentSessionDecodeError();
  return { schemaVersion: 1, conversationId, afterSeq, watermark,
    ...(events === undefined ? {} : { events }), ...(row.resyncRequired === undefined ? {} : { resyncRequired: row.resyncRequired }) };
}

export interface AgentInterruptRequest { readonly conversationId: string; readonly turnId: string }
export interface AgentInterruptResponse extends AgentInterruptRequest {
  readonly schemaVersion: 1;
  /** Signal acknowledgement only. Durable history owns the final outcome. */
  readonly cancellationRequested: boolean;
}
export function decodeAgentInterruptResponse(value: unknown): AgentInterruptResponse {
  const row = object(value, ["schemaVersion", "conversationId", "turnId", "cancellationRequested"]);
  if (row.schemaVersion !== 1 || typeof row.cancellationRequested !== "boolean") throw new AgentSessionDecodeError();
  return { schemaVersion: 1, conversationId: identity(row.conversationId), turnId: identity(row.turnId), cancellationRequested: row.cancellationRequested };
}
