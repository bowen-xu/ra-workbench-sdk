import { utf8Length } from "./workspaceDecoding";
import { agentReasoningSummaryParts, decodeAgentReasoningSummaryIndex, decodeAgentReasoningSummaryParts, type AgentReasoningSummaryIndex, type AgentReasoningSummaryPart } from "./reasoningSummary";
const MAX_NATIVE_ITEM_BYTES = 16 * 1024 * 1024;
/** Wire contract owned by research-agent-core/protocol, checked with its exported fixture. */
export type AgentTurnPhase = "preparing" | "runningModel" | "runningTools" | "awaitingInput" | "awaitingApproval";
export type AgentTurnOutcome = "completed" | "failed" | "canceled" | "interrupted";
export type AgentTaskKind = "regular" | "compact";
export type AgentFailureCategory = "admission" | "toolRound" | "persistence" | "recovery" | "provider" | "providerTemporaryUnavailable";
export type AgentAssistantMessagePhase = "commentary" | "reasoning" | "finalAnswer";
export interface AgentHookPromptFragment { readonly runId: string; readonly inputText: string }
export type AgentItemKind =
  | { readonly type: "userMessage" | "assistantMessage" | "contextCompaction" }
  | { readonly type: "providerNative"; readonly itemType: string }
  | { readonly type: "hookPrompt"; readonly invocationId: string; readonly fragments: readonly AgentHookPromptFragment[] }
  | { readonly type: "reasoningSummary"; readonly parts: readonly AgentReasoningSummaryPart[] }
  | { readonly type: "toolCall"; readonly callId: string; readonly name: string; readonly namespace?: string; readonly providerCallId?: string }
  | { readonly type: "toolResult"; readonly callId: string; readonly isError?: boolean };
export interface AgentModelIdentity {
  readonly providerId: string;
  readonly modelId: string;
  readonly revision: string | null;
}
export interface AgentCanonicalItemSource {
  readonly attemptId: string;
  readonly ordinal: number;
  readonly providerItemId: string | null;
  readonly providerDataJson: string | null;
}
export type AgentEventPayload =
  | { readonly type: "conversationRolledBack"; readonly turnId: string; readonly userTurns: number }
  | { readonly type: "modelRequestStarted"; readonly turnId: string; readonly attemptId: string; readonly model: AgentModelIdentity }
  | { readonly type: "modelOutputInterleavingStarted"; readonly turnId: string; readonly attemptId: string }
  | { readonly type: "modelResponseStarted"; readonly turnId: string; readonly attemptId: string; readonly responseId: string; readonly model: AgentModelIdentity | null }
  | { readonly type: "modelIdentityObserved"; readonly turnId: string; readonly attemptId: string; readonly model: AgentModelIdentity }
  | { readonly type: "modelRequestFinished"; readonly turnId: string; readonly attemptId: string; readonly inputTokens: number | null; readonly outputTokens: number | null }
  | { readonly type: "modelCompactionFinished"; readonly turnId: string; readonly attemptId: string; readonly inputTokens: number | null; readonly outputTokens: number | null }
  | { readonly type: "modelRequestFailed"; readonly turnId: string; readonly attemptId: string; readonly error: string; readonly retryable: boolean; readonly category: AgentFailureCategory | null }
  | { readonly type: "turnStarted"; readonly turnId: string; readonly contextSnapshotId: string; readonly model: AgentModelIdentity; readonly taskKind?: AgentTaskKind }
  | { readonly type: "phaseChanged"; readonly turnId: string; readonly phase: AgentTurnPhase }
  | { readonly type: "itemStarted"; readonly turnId: string; readonly itemId: string; readonly kind: AgentItemKind }
  | { readonly type: "itemAccepted"; readonly turnId: string; readonly itemId: string; readonly kind: AgentItemKind; readonly text: string; readonly phase: AgentAssistantMessagePhase | null; readonly source: AgentCanonicalItemSource | null }
  | { readonly type: "itemPhaseChanged"; readonly turnId: string; readonly itemId: string; readonly phase: AgentAssistantMessagePhase; readonly native?: boolean }
  | { readonly type: "modelOutputOrder"; readonly turnId: string; readonly itemIds: readonly string[] }
  | { readonly type: "textDelta"; readonly turnId: string; readonly itemId: string; readonly text: string }
  | { readonly type: "reasoningSummaryPartAdded"; readonly turnId: string; readonly itemId: string; readonly summaryIndex: AgentReasoningSummaryIndex }
  | { readonly type: "reasoningSummaryDelta"; readonly turnId: string; readonly itemId: string; readonly summaryIndex: AgentReasoningSummaryIndex; readonly text: string }
  | { readonly type: "itemCompleted"; readonly turnId: string; readonly itemId: string }
  | { readonly type: "childCreationPrepared"; readonly turnId: string; readonly callId: string; readonly version: 1; readonly childId: string; readonly operationId: string; readonly binding: { readonly kind: "manuscript" | "paper" | "note" | "readingNote"; readonly resourceId: string } }
  | { readonly type: "childCreationPrepared"; readonly turnId: string; readonly callId: string; readonly version: 2; readonly childId: string; readonly operationId: string; readonly submissionRequestId: string; readonly binding: { readonly kind: "manuscript" | "paper" | "note" | "readingNote"; readonly resourceId: string } }
  | { readonly type: "toolReceiptPending" | "toolReceiptConfirmed"; readonly turnId: string; readonly callId: string }
  | { readonly type: "usage"; readonly turnId: string; readonly inputTokens: number | null; readonly outputTokens: number | null }
  | { readonly type: "turnFailed"; readonly turnId: string; readonly error: string; readonly category: AgentFailureCategory }
  | { readonly type: "turnFinished"; readonly turnId: string; readonly outcome: AgentTurnOutcome };
export interface AgentEvent {
  readonly schemaVersion: 1;
  readonly conversationId: string;
  readonly seq: number;
  readonly timestampMs: number;
  readonly requestId: string;
  readonly payload: AgentEventPayload;
}

export class AgentEventDecodeError extends Error {
  constructor() { super("Invalid or unsupported agent event"); this.name = "AgentEventDecodeError"; }
}

function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some((key) => !keys.includes(key))) throw new AgentEventDecodeError();
  return value as Record<string, unknown>;
}
function uuid(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new AgentEventDecodeError();
  return value.toLowerCase();
}
function integer(value: unknown, minimum = 0): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) throw new AgentEventDecodeError();
  return value;
}
function name(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || Array.from(value).length > 256) throw new AgentEventDecodeError();
  return value;
}
function choice<T extends string>(value: unknown, choices: readonly T[]): T {
  if (typeof value !== "string" || !choices.includes(value as T)) throw new AgentEventDecodeError();
  return value as T;
}
function kind(value: unknown): AgentItemKind {
  const base = record(value, ["type", "callId", "name", "namespace", "providerCallId", "isError", "itemType", "parts", "invocationId", "fragments"]);
  switch (base.type) {
    case "contextCompaction":
    case "userMessage":
      record(value, ["type"]); return { type: base.type };
    case "assistantMessage": {
      record(value, ["type"]);
      return { type: base.type };
    }
    case "providerNative": {
      record(value, ["type", "itemType"]);
      return { type: base.type, itemType: name(base.itemType) };
    }
    case "hookPrompt": {
      record(value, ["type", "invocationId", "fragments"]);
      const invocationId = uuid(base.invocationId);
      if (invocationId === "00000000-0000-0000-0000-000000000000") throw new AgentEventDecodeError();
      return { type: base.type, invocationId, fragments: decodeHookPromptFragments(base.fragments) };
    }
    case "reasoningSummary": {
      record(value, ["type", "parts"]);
      try { return { type: base.type, parts: decodeAgentReasoningSummaryParts(base.parts) }; }
      catch { throw new AgentEventDecodeError(); }
    }
    case "toolCall": {
      record(value, ["type", "callId", "name", "namespace", "providerCallId"]);
      // Namespace is exact identity evidence: only missing/null means flat.
      if (base.namespace != null && typeof base.namespace !== "string") throw new AgentEventDecodeError();
      return { type: base.type, callId: uuid(base.callId), name: name(base.name),
        ...(typeof base.namespace === "string" ? { namespace: base.namespace } : {}),
        ...(base.providerCallId == null ? {} : { providerCallId: name(base.providerCallId) }) };
    }
    case "toolResult": {
      record(value, ["type", "callId", "isError"]);
      if (base.isError != null && typeof base.isError !== "boolean") throw new AgentEventDecodeError();
      return { type: base.type, callId: uuid(base.callId), ...(base.isError == null ? {} : { isError: base.isError }) };
    }
    default: throw new AgentEventDecodeError();
  }
}

export function decodeHookPromptFragments(value: unknown): AgentHookPromptFragment[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 32) throw new AgentEventDecodeError();
  const runs = new Set<string>();
  const fragments = value.map(part => {
    const row = record(part, ["runId", "inputText"]);
    const runId = uuid(row.runId);
    if (runId === "00000000-0000-0000-0000-000000000000" || runs.has(runId)
      || typeof row.inputText !== "string" || row.inputText.length === 0) throw new AgentEventDecodeError();
    try { utf8Length(row.inputText); } catch { throw new AgentEventDecodeError(); }
    runs.add(runId);
    return { runId, inputText: row.inputText };
  });
  if (utf8Length(JSON.stringify(fragments)) > MAX_NATIVE_ITEM_BYTES) throw new AgentEventDecodeError();
  return fragments;
}

/** Match Rust serde_json::to_vec(String), including quotes and escapes. */
function itemMetadataBytes(kind: AgentItemKind): number {
  if (kind.type === "reasoningSummary") return utf8Length(JSON.stringify(kind.parts));
  return kind.type === "toolCall" && kind.namespace !== undefined ? utf8Length(JSON.stringify(kind.namespace)) : 0;
}

/** Native-only facts remain opaque to presentation; validate their envelope,
 * without interpreting, logging or lowering provider-specific material. */
function validateNativeItem(json: string, itemType: string): void {
  const item: unknown = JSON.parse(json);
  const object = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value);
  const nativeName = (value: unknown): value is string => typeof value === "string"
    && value.trim().length > 0 && utf8Length(value) <= 1024 && !value.includes("\0");
  const model = (value: unknown): boolean => object(value) && nativeName(value.providerId)
    && nativeName(value.modelId) && (value.revision == null || nativeName(value.revision));
  if (!object(item) || item.schema_version !== 1 || item.item_type !== itemType
    || !nativeName(item.api) || !model(item.model) || !object(item.data)
    || (item.actual_model != null && !model(item.actual_model))
    || (item.response_id != null && !nativeName(item.response_id))
    || (item.item_id != null && !nativeName(item.item_id))) throw new AgentEventDecodeError();
  if (item.account_scope != null && uuid(item.account_scope) === "00000000-0000-0000-0000-000000000000") throw new AgentEventDecodeError();
}

function payload(value: unknown): AgentEventPayload {
  if (!value || typeof value !== "object" || !("type" in value)) throw new AgentEventDecodeError();
  const common = ["type", "turnId"];
  switch (value.type) {
    case "childCreationPrepared": {
      const input = record(value, [...common, "callId", "version", "childId", "operationId", "binding", "submissionRequestId"]);
      if (input.version !== 1 && input.version !== 2) throw new AgentEventDecodeError();
      const turnId = uuid(input.turnId), callId = uuid(input.callId), childId = uuid(input.childId), operationId = uuid(input.operationId);
      if ([turnId, callId, childId, operationId].includes("00000000-0000-0000-0000-000000000000")) throw new AgentEventDecodeError();
      const binding = record(input.binding, ["kind", "resourceId"]), resourceId = name(binding.resourceId);
      if (resourceId.includes("\0")) throw new AgentEventDecodeError();
      const base = { type: value.type, turnId, callId, childId, operationId, binding: { kind: choice(binding.kind, ["manuscript", "paper", "note", "readingNote"] as const), resourceId } };
      if (input.version === 1) {
        if (input.submissionRequestId != null) throw new AgentEventDecodeError();
        return { ...base, version: 1 };
      }
      const submissionRequestId = uuid(input.submissionRequestId);
      if (submissionRequestId === "00000000-0000-0000-0000-000000000000") throw new AgentEventDecodeError();
      return { ...base, version: 2, submissionRequestId };
    }
    case "toolReceiptPending": case "toolReceiptConfirmed": {
      const input = record(value, [...common, "callId"]);
      const turnId = uuid(input.turnId), callId = uuid(input.callId);
      if (turnId === "00000000-0000-0000-0000-000000000000" || callId === "00000000-0000-0000-0000-000000000000") throw new AgentEventDecodeError();
      return { type: value.type, turnId, callId };
    }
    case "conversationRolledBack": {
      const input = record(value, [...common, "userTurns"]);
      const turnId = uuid(input.turnId);
      const userTurns = integer(input.userTurns, 1);
      if (turnId === "00000000-0000-0000-0000-000000000000" || userTurns > 0xffff_ffff) throw new AgentEventDecodeError();
      return { type: value.type, turnId, userTurns };
    }
    case "modelRequestStarted": case "modelResponseStarted": case "modelIdentityObserved": {
      const input = record(value, [...common, "attemptId", "model", ...(value.type === "modelResponseStarted" ? ["responseId"] : [])]);
      const source = input.model == null && value.type === "modelResponseStarted" ? null : record(input.model, ["providerId", "modelId", "revision"]);
      const model = source === null ? null : { providerId: name(source.providerId), modelId: name(source.modelId), revision: source.revision == null ? null : name(source.revision) };
      const base = { turnId: uuid(input.turnId), attemptId: uuid(input.attemptId), model };
      if (value.type === "modelResponseStarted") return { ...base, type: value.type, responseId: name(input.responseId) };
      if (!model) throw new AgentEventDecodeError();
      return { ...base, type: value.type, model };
    }
    case "modelRequestFinished": case "modelCompactionFinished": {
      const input = record(value, [...common, "attemptId", "inputTokens", "outputTokens"]);
      return { type: value.type, turnId: uuid(input.turnId), attemptId: uuid(input.attemptId),
        inputTokens: input.inputTokens == null ? null : integer(input.inputTokens), outputTokens: input.outputTokens == null ? null : integer(input.outputTokens) };
    }
    case "modelOutputInterleavingStarted": {
      const input = record(value, [...common, "attemptId"]);
      const turnId = uuid(input.turnId), attemptId = uuid(input.attemptId);
      if (turnId === "00000000-0000-0000-0000-000000000000" || attemptId === "00000000-0000-0000-0000-000000000000") throw new AgentEventDecodeError();
      return { type: value.type, turnId, attemptId };
    }
    case "modelRequestFailed": {
      const input = record(value, [...common, "attemptId", "error", "retryable", "category"]);
      if (typeof input.error !== "string" || !input.error || Array.from(input.error).length > 1_024
        || typeof input.retryable !== "boolean") throw new AgentEventDecodeError();
      return { type: value.type, turnId: uuid(input.turnId), attemptId: uuid(input.attemptId),
        error: input.error, retryable: input.retryable,
        category: input.category == null ? null : choice(input.category, ["admission", "toolRound", "persistence", "recovery", "provider", "providerTemporaryUnavailable"] as const) };
    }
    case "turnStarted": {
      const input = record(value, [...common, "contextSnapshotId", "model", "taskKind"]);
      const model = record(input.model, ["providerId", "modelId", "revision"]);
      return { type: value.type, turnId: uuid(input.turnId), contextSnapshotId: uuid(input.contextSnapshotId),
        ...(input.taskKind === undefined ? {} : { taskKind: choice(input.taskKind, ["regular", "compact"] as const) }),
        model: { providerId: name(model.providerId), modelId: name(model.modelId), revision: model.revision == null ? null : name(model.revision) } };
    }
    case "phaseChanged": {
      const input = record(value, [...common, "phase"]);
      return { type: value.type, turnId: uuid(input.turnId), phase: choice(input.phase, ["preparing", "runningModel", "runningTools", "awaitingInput", "awaitingApproval"]) };
    }
    case "itemStarted": {
      const input = record(value, [...common, "itemId", "kind"]);
      const itemKind = kind(input.kind);
      if (itemKind.type === "providerNative" || itemKind.type === "hookPrompt" || itemMetadataBytes(itemKind) > MAX_NATIVE_ITEM_BYTES
        || (itemKind.type === "reasoningSummary" && itemKind.parts.length !== 0)) throw new AgentEventDecodeError();
      return { type: value.type, turnId: uuid(input.turnId), itemId: uuid(input.itemId), kind: itemKind };
    }
    case "itemAccepted": {
      const input = record(value, [...common, "itemId", "kind", "text", "phase", "source"]);
      const itemKind = kind(input.kind);
      const metadataBytes = itemMetadataBytes(itemKind);
      if (itemKind.type === "userMessage" || itemKind.type === "contextCompaction"
        || typeof input.text !== "string" || utf8Length(input.text) > MAX_NATIVE_ITEM_BYTES
        || metadataBytes > MAX_NATIVE_ITEM_BYTES) throw new AgentEventDecodeError();
      const phase = input.phase == null ? null : choice(input.phase, ["commentary", "finalAnswer"] as const);
      if (phase !== null && itemKind.type !== "assistantMessage") throw new AgentEventDecodeError();
      const raw = input.source == null ? null : record(input.source, ["attemptId", "ordinal", "providerItemId", "providerDataJson"]);
      let source: AgentCanonicalItemSource | null = null;
      if (raw !== null) {
        if (raw.providerDataJson != null) {
          if (typeof raw.providerDataJson !== "string" || metadataBytes + utf8Length(raw.providerDataJson) > MAX_NATIVE_ITEM_BYTES) throw new AgentEventDecodeError();
          try { JSON.parse(raw.providerDataJson); } catch { throw new AgentEventDecodeError(); }
        }
        const ordinal = integer(raw.ordinal);
        if (ordinal > 0xffff_ffff) throw new AgentEventDecodeError();
        source = { attemptId: uuid(raw.attemptId), ordinal, providerItemId: raw.providerItemId == null ? null : name(raw.providerItemId), providerDataJson: raw.providerDataJson == null ? null : raw.providerDataJson as string };
      }
      if (itemKind.type === "providerNative") {
        if (input.text !== "" || phase !== null || !source?.providerDataJson
          || ["message", "function_call"].includes(itemKind.itemType)) throw new AgentEventDecodeError();
        validateNativeItem(source.providerDataJson, itemKind.itemType);
      }
      if (itemKind.type === "hookPrompt" && (input.text !== "" || phase !== null || source !== null)) throw new AgentEventDecodeError();
      if (itemKind.type === "reasoningSummary") {
        try { agentReasoningSummaryParts(input.text, itemKind.parts); } catch { throw new AgentEventDecodeError(); }
      }
      return { type: value.type, turnId: uuid(input.turnId), itemId: uuid(input.itemId), kind: itemKind, text: input.text, phase, source };
    }
    case "itemPhaseChanged": {
      const input = record(value, [...common, "itemId", "phase", "native"]);
      if (input.native !== undefined && typeof input.native !== "boolean") throw new AgentEventDecodeError();
      const phase = choice(input.phase, ["commentary", "reasoning", "finalAnswer"] as const);
      if (input.native === true && phase === "reasoning") throw new AgentEventDecodeError();
      return { type: value.type, turnId: uuid(input.turnId), itemId: uuid(input.itemId), phase,
        ...(input.native === undefined ? {} : { native: input.native }) };
    }
    case "modelOutputOrder": {
      const input = record(value, [...common, "itemIds"]);
      if (!Array.isArray(input.itemIds) || input.itemIds.length === 0 || input.itemIds.length > 500) throw new AgentEventDecodeError();
      const itemIds = input.itemIds.map(uuid);
      if (new Set(itemIds).size !== itemIds.length) throw new AgentEventDecodeError();
      return { type: value.type, turnId: uuid(input.turnId), itemIds };
    }
    case "textDelta": {
      const input = record(value, [...common, "itemId", "text"]);
      if (typeof input.text !== "string" || !input.text || Array.from(input.text).length > 65_536) throw new AgentEventDecodeError();
      return { type: value.type, turnId: uuid(input.turnId), itemId: uuid(input.itemId), text: input.text };
    }
    case "reasoningSummaryPartAdded": case "reasoningSummaryDelta": {
      const input = record(value, [...common, "itemId", "summaryIndex", ...(value.type === "reasoningSummaryDelta" ? ["text"] : [])]);
      let summaryIndex: AgentReasoningSummaryIndex;
      try { summaryIndex = decodeAgentReasoningSummaryIndex(input.summaryIndex); } catch { throw new AgentEventDecodeError(); }
      const base = { turnId: uuid(input.turnId), itemId: uuid(input.itemId), summaryIndex };
      if (value.type === "reasoningSummaryPartAdded") return { type: value.type, ...base };
      if (typeof input.text !== "string" || !input.text || Array.from(input.text).length > 65_536) throw new AgentEventDecodeError();
      try { utf8Length(input.text); } catch { throw new AgentEventDecodeError(); }
      return { type: value.type, ...base, text: input.text };
    }
    case "itemCompleted": {
      const input = record(value, [...common, "itemId"]);
      return { type: value.type, turnId: uuid(input.turnId), itemId: uuid(input.itemId) };
    }
    case "usage": {
      const input = record(value, [...common, "inputTokens", "outputTokens"]);
      return { type: value.type, turnId: uuid(input.turnId), inputTokens: input.inputTokens == null ? null : integer(input.inputTokens), outputTokens: input.outputTokens == null ? null : integer(input.outputTokens) };
    }
    case "turnFailed": {
      const input = record(value, [...common, "error", "category"]);
      if (typeof input.error !== "string" || !input.error.trim() || Array.from(input.error).length > 1024 || /[\u0000-\u001f\u007f-\u009f]/u.test(input.error)) throw new AgentEventDecodeError();
      return { type: value.type, turnId: uuid(input.turnId), error: input.error,
        category: choice(input.category, ["admission", "toolRound", "persistence", "recovery", "provider", "providerTemporaryUnavailable"] as const) };
    }
    case "turnFinished": {
      const input = record(value, [...common, "outcome"]);
      return { type: value.type, turnId: uuid(input.turnId), outcome: choice(input.outcome, ["completed", "failed", "canceled", "interrupted"]) };
    }
    default: throw new AgentEventDecodeError();
  }
}

/** Decode an untrusted desktop event; never cast IPC data directly to AgentEvent. */
export function decodeAgentEvent(value: unknown): AgentEvent {
  const input = record(value, ["schemaVersion", "conversationId", "seq", "timestampMs", "requestId", "payload"]);
  if (input.schemaVersion !== 1) throw new AgentEventDecodeError();
  return { schemaVersion: 1, conversationId: uuid(input.conversationId), seq: integer(input.seq, 1),
    timestampMs: integer(input.timestampMs), requestId: uuid(input.requestId), payload: payload(input.payload) };
}
