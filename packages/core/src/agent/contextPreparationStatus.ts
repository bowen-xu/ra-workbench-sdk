import {agentSqlFence, catalogOperationId} from "./catalogOperationDecoding";
import {decodeNativeAgentContextResource} from "./queuePreviewPreparation";
import {decodeAgentRequestUserInput} from "./requestUserInput";
import {decodeAgentRetrievalSelection, type AgentRetrievalSelection} from "./retrieval";
import {decodeAgentSqlImmediateFailure, type AgentSqlImmediateDiagnostic} from "./sqlImmediateDiagnostic";
import {AgentSubmissionDecodeError, decodeAgentSubmissionText, type AgentModelSelection} from "./submission";
import {decodeAgentContextPreview, decodeAgentContextQueueConfirmation, type AgentContextPrepareRequest, type AgentContextPreview, type AgentContextQueueConfirmation} from "./contextSession";
import type {AgentContextResource} from "./contextSelection";
import type {AgentUserInput} from "./userInput";

export const AGENT_CONTEXT_PREPARE_FAMILY = "agent.context.submission.prepare";
export interface AgentContextPrepareIntent {
  readonly conversationId: string; readonly requestId: string; readonly text: string;
  readonly resources: readonly AgentContextResource[]; readonly userInput: readonly AgentUserInput[];
  readonly retrieval: AgentRetrievalSelection | null; readonly model: AgentModelSelection | null;
  readonly queue: AgentContextQueueConfirmation | null;
}
export interface AgentContextPrepareProof {
  readonly schemaVersion: 1; readonly operationId: string; readonly conversationId: string;
  readonly family: typeof AGENT_CONTEXT_PREPARE_FAMILY; readonly epoch: string;
  readonly sqlFence: string; readonly replayed: boolean; readonly result: null;
}
export interface AgentContextPrepareStatusResponse {
  readonly schemaVersion: 1; readonly intent: AgentContextPrepareIntent; readonly expectedEpoch: string | null;
  readonly status: {readonly type: "unconfirmed"; readonly detail: AgentSqlImmediateDiagnostic}
    | {readonly type: "committed"; readonly proof: AgentContextPrepareProof; readonly result: AgentContextPreview};
}
function fail(): never {throw new AgentSubmissionDecodeError();}
function fields(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const row = value as Record<string, unknown>;
  if (required.some(key => !Object.hasOwn(row, key)) || Object.keys(row).some(key => !required.includes(key) && !optional.includes(key))) return fail();
  return row;
}
function id(value: unknown): string {try {return catalogOperationId(value);} catch {return fail();}}
function string(value: unknown): string {return typeof value === "string" ? value : fail();}
/** Apply native defaults before comparing the original request; this does not resolve resources. */
export function decodeAgentContextPrepareIntent(value: unknown): AgentContextPrepareIntent {
  const row = fields(value, ["conversationId", "requestId", "text", "resources"], ["userInput", "retrieval", "model", "queue"]);
  const text = decodeAgentSubmissionText(row.text);
  if (!Array.isArray(row.resources) || row.resources.length > 32) return fail();
  const model = row.model == null ? null : fields(row.model, ["providerId", "modelId"], ["reasoningEffort", "serviceTier"]);
  if (model?.serviceTier != null && model.serviceTier !== "fast" && model.serviceTier !== "default") return fail();
  const queue = row.queue == null ? null : decodeAgentContextQueueConfirmation(row.queue);
  if (queue && queue.expectedRevision >= Number.MAX_SAFE_INTEGER) return fail();
  return {conversationId: id(row.conversationId), requestId: id(row.requestId), text,
    resources: row.resources.map(decodeNativeAgentContextResource), userInput: decodeAgentRequestUserInput(row.userInput, text),
    retrieval: row.retrieval == null ? null : decodeAgentRetrievalSelection(row.retrieval),
    model: model && {providerId: string(model.providerId), modelId: string(model.modelId),
      reasoningEffort: model.reasoningEffort == null ? null : string(model.reasoningEffort),
      serviceTier: model.serviceTier == null ? null : model.serviceTier as "fast" | "default"}, queue};
}
export function sameAgentContextPrepareIntent(a: AgentContextPrepareRequest | AgentContextPrepareIntent, b: AgentContextPrepareRequest | AgentContextPrepareIntent): boolean {
  return JSON.stringify(decodeAgentContextPrepareIntent(a)) === JSON.stringify(decodeAgentContextPrepareIntent(b));
}
export function decodeAgentContextPrepareStatusResponse(value: unknown): AgentContextPrepareStatusResponse {
  const row = fields(value, ["schemaVersion", "intent", "expectedEpoch", "status"]);
  if (row.schemaVersion !== 1) return fail();
  const intent = decodeAgentContextPrepareIntent(row.intent), expectedEpoch = row.expectedEpoch === null ? null : id(row.expectedEpoch);
  const status = fields(row.status, ["type"], ["detail", "proof", "result"]);
  if (status.type === "unconfirmed") {
    fields(status, ["type", "detail"]);
    const detail = fields(status.detail, ["operationId", "epoch", "sqlFence", "phase", "sqliteCode", "sqliteExtendedCode", "safeCause"]);
    const decoded = decodeAgentSqlImmediateFailure({code: "DATA_SQL_RECOVERY_REQUIRED", reason: detail})?.diagnostic;
    if (!decoded || id(decoded.operationId) !== intent.requestId || !decoded.phase || !decoded.safeCause
      || ["epoch", "sqlFence", "sqliteCode", "sqliteExtendedCode"].some(key => !Object.hasOwn(decoded, key))
      || expectedEpoch && decoded.epoch && id(decoded.epoch) !== expectedEpoch) return fail();
    return {schemaVersion: 1, intent, expectedEpoch, status: {type: "unconfirmed", detail: {...decoded, operationId: intent.requestId}}};
  }
  if (status.type !== "committed") return fail();
  fields(status, ["type", "proof", "result"]);
  const p = fields(status.proof, ["schemaVersion", "operationId", "conversationId", "family", "epoch", "sqlFence", "replayed", "result"]);
  if (p.schemaVersion !== 1 || p.family !== AGENT_CONTEXT_PREPARE_FAMILY || p.result !== null || typeof p.replayed !== "boolean"
    || id(p.operationId) !== intent.requestId || id(p.conversationId) !== intent.conversationId) return fail();
  const epoch = id(p.epoch); if (expectedEpoch && epoch !== expectedEpoch) return fail();
  const result = decodeAgentContextPreview(status.result);
  if (result.conversationId !== intent.conversationId || result.requestId !== intent.requestId || result.input.text !== intent.text
    || (intent.queue ? !result.queue || result.queue.inputId !== intent.queue.inputId || result.queue.expectedRevision !== intent.queue.expectedRevision + 1 : !!result.queue)
    || (intent.model && (result.input.model.providerId !== intent.model.providerId || result.input.model.modelId !== intent.model.modelId
      || result.input.reasoningEffort !== (intent.model.reasoningEffort ?? null)))) return fail();
  return {schemaVersion: 1, intent, expectedEpoch, status: {type: "committed", result, proof: {schemaVersion: 1,
    operationId: intent.requestId, conversationId: intent.conversationId, family: AGENT_CONTEXT_PREPARE_FAMILY,
    epoch, sqlFence: agentSqlFence(p.sqlFence), replayed: p.replayed, result: null}}};
}
