import { decodeHookPromptFragments, type AgentHookPromptFragment, type AgentModelIdentity, type AgentTurnOutcome, type AgentTurnPhase } from "./events";
import { agentReasoningSummaryParts, decodeAgentReasoningSummaryParts, type AgentReasoningSummaryPart } from "./reasoningSummary";

/** Portable transcript only: contains no provider continuation or execution authority. */
export interface AgentConversationExport {
  readonly format: "research-assistant.conversation";
  readonly schemaVersion: 1;
  readonly conversation: {
    readonly id: string; readonly title: string; readonly archived: boolean;
    readonly createdAt: string; readonly updatedAt: string;
  };
  readonly watermark: number;
  readonly turns: readonly AgentExportTurn[];
}
export interface AgentExportTurn {
  readonly id: string;
  readonly contextSnapshotId: string;
  readonly model: AgentModelIdentity;
  readonly phase: AgentTurnPhase;
  readonly outcome: AgentTurnOutcome | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly items: readonly AgentExportItem[];
  readonly attempts: readonly AgentExportAttempt[];
}
export interface AgentExportAttempt {
  readonly id: string;
  readonly requestedModel: AgentModelIdentity;
  readonly actualModel: AgentModelIdentity | null;
  readonly outcome: AgentTurnOutcome | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
}
export type AgentExportItemKind =
  | { readonly type: "hookPrompt"; readonly invocationId: string; readonly fragments: readonly AgentHookPromptFragment[] }
  | { readonly type: "providerNative"; readonly itemType: string }
  | { readonly type: "reasoningSummary"; readonly parts: readonly AgentReasoningSummaryPart[] }
  | { readonly type: "userMessage" | "assistantMessage" | "contextCompaction" }
  | { readonly type: "toolCall"; readonly callId: string; readonly name: string; readonly namespace?: string }
  | { readonly type: "toolResult"; readonly callId: string; readonly isError: boolean | null };
export interface AgentExportItem {
  readonly id: string; readonly kind: AgentExportItemKind; readonly text: string;
  readonly completed: boolean; readonly interrupted: boolean;
}
export class AgentExportDecodeError extends Error {
  constructor() { super("Invalid or unsupported conversation export"); this.name = "AgentExportDecodeError"; }
}
export interface AgentConversationDownload {
  readonly schemaVersion: 1;
  readonly conversationId: string;
  readonly watermark: number;
  readonly destinationPath: string;
  readonly byteSize: number;
}
export function decodeAgentConversationDownload(value: unknown): AgentConversationDownload {
  const row = record(value, ["schemaVersion", "conversationId", "watermark", "destinationPath", "byteSize"]);
  if (row.schemaVersion !== 1 || typeof row.destinationPath !== "string" || !row.destinationPath.endsWith(".json")
    || row.destinationPath.includes("\0") || !/^(?:\/|[a-z]:[\\/]|\\\\)/iu.test(row.destinationPath)) throw new AgentExportDecodeError();
  const watermark = integer(row.watermark), byteSize = integer(row.byteSize);
  if (watermark > 200_000 || byteSize === 0) throw new AgentExportDecodeError();
  return { schemaVersion: 1, conversationId: uuid(row.conversationId), watermark, byteSize, destinationPath: row.destinationPath };
}
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== keys.length
    || keys.some((key) => !Object.hasOwn(value, key))) throw new AgentExportDecodeError();
  return value as Record<string, unknown>;
}
function uuid(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(value)
    || value === "00000000-0000-0000-0000-000000000000") throw new AgentExportDecodeError();
  return value.toLowerCase();
}
function integer(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new AgentExportDecodeError();
  return value;
}
function flag(value: unknown): boolean {
  if (typeof value !== "boolean") throw new AgentExportDecodeError();
  return value;
}
function name(value: unknown, limit = 256): string {
  if (typeof value !== "string" || !value.trim() || [...value].length > limit || value.includes("\0")) throw new AgentExportDecodeError();
  return value;
}
function timestamp(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
    || !Number.isFinite(Date.parse(value))) throw new AgentExportDecodeError();
  return value;
}
function nullable<T>(value: unknown, decode: (v: unknown) => T): T | null { return value === null ? null : decode(value); }
function choice<T extends string>(value: unknown, options: readonly T[]): T {
  if (typeof value !== "string" || !options.includes(value as T)) throw new AgentExportDecodeError();
  return value as T;
}
function outcome(value: unknown): AgentTurnOutcome { return choice(value, ["completed", "failed", "canceled", "interrupted"]); }
function model(value: unknown): AgentModelIdentity {
  const row = record(value, ["providerId", "modelId", "revision"]);
  return { providerId: name(row.providerId), modelId: name(row.modelId), revision: nullable(row.revision, name) };
}
function kind(value: unknown): AgentExportItemKind {
  if (!value || typeof value !== "object" || !("type" in value)) throw new AgentExportDecodeError();
  switch (value.type) {
    case "contextCompaction":
    case "userMessage": case "assistantMessage":
      record(value, ["type"]); return { type: value.type };
    case "providerNative": {
      const row = record(value, ["type", "itemType"]);
      return { type: value.type, itemType: name(row.itemType) };
    }
    case "hookPrompt": {
      const row = record(value, ["type", "invocationId", "fragments"]);
      try { return { type: value.type, invocationId: uuid(row.invocationId), fragments: decodeHookPromptFragments(row.fragments) }; }
      catch { throw new AgentExportDecodeError(); }
    }
    case "reasoningSummary": {
      const row = record(value, ["type", "parts"]);
      try { return { type: value.type, parts: decodeAgentReasoningSummaryParts(row.parts) }; }
      catch { throw new AgentExportDecodeError(); }
    }
    case "toolCall": {
      const row = record(value, ["type", "callId", "name", ...(Object.hasOwn(value, "namespace") ? ["namespace"] : [])]);
      if (row.namespace != null && typeof row.namespace !== "string") throw new AgentExportDecodeError();
      return { type: value.type, callId: uuid(row.callId), name: name(row.name),
        ...(typeof row.namespace === "string" ? { namespace: row.namespace } : {}) };
    }
    case "toolResult": {
      const row = record(value, ["type", "callId", "isError"]);
      return { type: value.type, callId: uuid(row.callId), isError: nullable(row.isError, flag) };
    }
    default: throw new AgentExportDecodeError();
  }
}
function entries<T extends { readonly id: string }>(value: unknown, decode: (v: unknown) => T): T[] {
  if (!Array.isArray(value) || value.length > 200_000) throw new AgentExportDecodeError();
  const decoded = value.map(decode);
  if (new Set(decoded.map((entry) => entry.id)).size !== decoded.length) throw new AgentExportDecodeError();
  return decoded;
}
function item(value: unknown): AgentExportItem {
  const row = record(value, ["id", "kind", "text", "completed", "interrupted"]);
  if (typeof row.text !== "string") throw new AgentExportDecodeError();
  const completed = flag(row.completed), interrupted = flag(row.interrupted);
  if (completed && interrupted) throw new AgentExportDecodeError();
  const itemKind = kind(row.kind);
  if (itemKind.type === "providerNative" && (row.text !== "" || !completed || interrupted)) throw new AgentExportDecodeError();
  if (itemKind.type === "hookPrompt" && (row.text !== "" || !completed || interrupted)) throw new AgentExportDecodeError();
  if (itemKind.type === "reasoningSummary") {
    try { agentReasoningSummaryParts(row.text, itemKind.parts); }
    catch { throw new AgentExportDecodeError(); }
  }
  return { id: uuid(row.id), kind: itemKind, text: row.text, completed, interrupted };
}
function attempt(value: unknown): AgentExportAttempt {
  const row = record(value, ["id", "requestedModel", "actualModel", "outcome", "inputTokens", "outputTokens"]);
  return { id: uuid(row.id), requestedModel: model(row.requestedModel), actualModel: nullable(row.actualModel, model),
    outcome: nullable(row.outcome, outcome), inputTokens: nullable(row.inputTokens, integer), outputTokens: nullable(row.outputTokens, integer) };
}
function turn(value: unknown): AgentExportTurn {
  const row = record(value, ["id", "contextSnapshotId", "model", "phase", "outcome", "inputTokens", "outputTokens", "items", "attempts"]);
  return { id: uuid(row.id), contextSnapshotId: uuid(row.contextSnapshotId), model: model(row.model),
    phase: choice(row.phase, ["preparing", "runningModel", "runningTools", "awaitingInput", "awaitingApproval"]),
    outcome: nullable(row.outcome, outcome), inputTokens: nullable(row.inputTokens, integer), outputTokens: nullable(row.outputTokens, integer),
    items: entries(row.items, item), attempts: entries(row.attempts, attempt) };
}
export function decodeAgentConversationExport(value: unknown): AgentConversationExport {
  const row = record(value, ["format", "schemaVersion", "conversation", "watermark", "turns"]);
  if (row.format !== "research-assistant.conversation" || row.schemaVersion !== 1) throw new AgentExportDecodeError();
  const meta = record(row.conversation, ["id", "title", "archived", "createdAt", "updatedAt"]);
  const watermark = integer(row.watermark), turns = entries(row.turns, turn);
  if (watermark > 200_000 || turns.length > watermark) throw new AgentExportDecodeError();
  return { format: row.format, schemaVersion: row.schemaVersion, watermark, turns,
    conversation: { id: uuid(meta.id), title: name(meta.title, 180), archived: flag(meta.archived),
      createdAt: timestamp(meta.createdAt), updatedAt: timestamp(meta.updatedAt) } };
}
