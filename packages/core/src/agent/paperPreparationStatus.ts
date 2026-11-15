import {agentSqlFence, catalogOperationId} from "./catalogOperationDecoding";
import {decodeAgentSqlImmediateFailure, type AgentSqlImmediateDiagnostic} from "./sqlImmediateDiagnostic";
import {AgentPaperSubmissionDecodeError, decodeAgentPaperSubmissionPrepareRequest, decodeAgentPaperSubmissionPreview,
  type AgentPaperSubmissionPrepareRequest, type AgentPaperSubmissionPreview} from "./paperSubmission";
import type {AgentUserInput} from "./userInput";

export const AGENT_PAPER_PREPARE_FAMILY = "agent.paper.submission.prepare";
export interface AgentPaperPrepareProof {
  readonly schemaVersion: 1; readonly operationId: string; readonly conversationId: string;
  readonly family: typeof AGENT_PAPER_PREPARE_FAMILY; readonly epoch: string;
  readonly sqlFence: string; readonly replayed: boolean; readonly result: null;
}
export interface AgentPaperPrepareStatusResponse {
  readonly schemaVersion: 1; readonly intent: AgentPaperSubmissionPrepareRequest;
  readonly status: {readonly type: "unconfirmed"; readonly detail: AgentSqlImmediateDiagnostic}
    | {readonly type: "committed"; readonly proof: AgentPaperPrepareProof; readonly result: AgentPaperSubmissionPreview};
}
function fail(): never {throw new AgentPaperSubmissionDecodeError();}
function fields(value: unknown, names: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== names.length || names.some(name => !Object.hasOwn(row, name))) return fail();
  return row;
}
function id(value: unknown): string {try {return catalogOperationId(value);} catch {return fail();}}
function nativeInput(input: readonly AgentUserInput[] | undefined): readonly AgentUserInput[] {
  return (input ?? []).map(item => {
    if (item.type !== "mention" || item.target.kind !== "file") return item;
    const {revision: _legacy, ...target} = item.target;
    return {...item, target};
  });
}
function canonical(value: AgentPaperSubmissionPrepareRequest) {
  const intent = decodeAgentPaperSubmissionPrepareRequest(value);
  return {conversationId: intent.conversationId, requestId: intent.requestId, paperId: intent.paperId,
    paperContextSnapshotId: intent.paperContextSnapshotId, expectedContextHash: intent.expectedContextHash,
    text: intent.text, userInput: nativeInput(intent.userInput), model: intent.model ?? null, retrieval: intent.retrieval ?? null,
    sessionConfig: intent.sessionConfig ?? null, turnConfig: intent.turnConfig ?? null};
}
function nativeIntent(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const row = value as Record<string, unknown>, model = row.model;
  if (!model || typeof model !== "object" || Array.isArray(model) || (model as Record<string, unknown>).serviceTier !== null) return value;
  const normalized = {...model as Record<string, unknown>};
  delete normalized.serviceTier;
  return {...row, model: normalized};
}
/** Compare every request field after applying the native defaults. */
export function sameAgentPaperPrepareRequest(a: AgentPaperSubmissionPrepareRequest, b: AgentPaperSubmissionPrepareRequest): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}
export function decodeAgentPaperPrepareResult(value: unknown, intent: AgentPaperSubmissionPrepareRequest): AgentPaperSubmissionPreview {
  const result = decodeAgentPaperSubmissionPreview(value);
  if (result.conversationId !== intent.conversationId || result.requestId !== intent.requestId
    || result.paperId !== intent.paperId || result.paperContextSnapshotId !== intent.paperContextSnapshotId
    || result.input.text !== intent.text || JSON.stringify(nativeInput(result.input.userInput)) !== JSON.stringify(nativeInput(intent.userInput))
    || (intent.model && (result.input.model.providerId !== intent.model.providerId || result.input.model.modelId !== intent.model.modelId
      || result.input.reasoningEffort !== (intent.model.reasoningEffort ?? null)))) return fail();
  return result;
}
export function decodeAgentPaperPrepareStatusResponse(value: unknown): AgentPaperPrepareStatusResponse {
  const row = fields(value, ["schemaVersion", "intent", "status"]);
  if (row.schemaVersion !== 1) return fail();
  const intent = decodeAgentPaperSubmissionPrepareRequest(nativeIntent(row.intent));
  if (!row.status || typeof row.status !== "object" || Array.isArray(row.status)) return fail();
  const status = row.status as Record<string, unknown>;
  if (status.type === "unconfirmed") {
    fields(status, ["type", "detail"]);
    const detail = fields(status.detail, ["operationId", "epoch", "sqlFence", "phase", "sqliteCode", "sqliteExtendedCode", "safeCause"]);
    const decoded = decodeAgentSqlImmediateFailure({code: "DATA_SQL_RECOVERY_REQUIRED", reason: detail})?.diagnostic;
    if (!decoded || id(decoded.operationId) !== intent.requestId || !decoded.phase || !decoded.safeCause
      || ["epoch", "sqlFence", "sqliteCode", "sqliteExtendedCode"].some(key => !Object.hasOwn(decoded, key))) return fail();
    return {schemaVersion: 1, intent, status: {type: "unconfirmed", detail: {...decoded, operationId: intent.requestId}}};
  }
  if (status.type !== "committed") return fail();
  fields(status, ["type", "proof", "result"]);
  const p = fields(status.proof, ["schemaVersion", "operationId", "conversationId", "family", "epoch", "sqlFence", "replayed", "result"]);
  if (p.schemaVersion !== 1 || p.family !== AGENT_PAPER_PREPARE_FAMILY || p.result !== null || typeof p.replayed !== "boolean"
    || id(p.operationId) !== intent.requestId || id(p.conversationId) !== intent.conversationId) return fail();
  let sqlFence: string; try {sqlFence = agentSqlFence(p.sqlFence);} catch {return fail();}
  const result = decodeAgentPaperPrepareResult(status.result, intent);
  return {schemaVersion: 1, intent, status: {type: "committed", result, proof: {schemaVersion: 1,
    operationId: intent.requestId, conversationId: intent.conversationId, family: AGENT_PAPER_PREPARE_FAMILY,
    epoch: id(p.epoch), sqlFence, replayed: p.replayed, result: null}}};
}
