import {catalogOperationId, agentSqlFence} from "./catalogOperationDecoding";
import {decodeAgentSqlImmediateFailure} from "./sqlImmediateDiagnostic";
import {decodeAgentWritingPrepareRequest} from "./queuePreviewPreparation";
import {decodeAgentContextResource} from "./contextSelection";
import type {AgentWritingQueueCancelDiagnostic} from "./queuePreviewCancellation";
import {AgentSubmissionDecodeError, decodeAgentSubmissionPreview, type AgentWritingPrepareRequest, type AgentSubmissionPreview} from "./submission";
import {decodeAgentWritingCompactionPreview, type AgentWritingCompactionPrepareRequest, type AgentWritingCompactionPreview} from "./compaction";

export const AGENT_WRITING_PREPARE_FAMILY = "agent.writing.submission.prepare";
export interface AgentWritingPrepareProof {
  readonly schemaVersion: 1; readonly operationId: string; readonly conversationId: string;
  readonly family: typeof AGENT_WRITING_PREPARE_FAMILY; readonly epoch: string;
  readonly sqlFence: string; readonly replayed: boolean; readonly result: null;
}
type Absent = {readonly type: "notFound"} | {readonly type: "unconfirmed"; readonly detail: AgentWritingQueueCancelDiagnostic};
export interface AgentWritingPrepareStatusResponse {
  readonly schemaVersion: 1; readonly intent: AgentWritingPrepareRequest;
  readonly status: Absent | {readonly type: "committed"; readonly proof: AgentWritingPrepareProof; readonly result: AgentSubmissionPreview};
}
export interface AgentWritingCompactionPrepareStatusResponse {
  readonly schemaVersion: 1; readonly intent: AgentWritingCompactionPrepareRequest;
  readonly status: Absent | {readonly type: "committed"; readonly proof: AgentWritingPrepareProof; readonly result: AgentWritingCompactionPreview};
}
function fail(): never {throw new AgentSubmissionDecodeError();}
function fields(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const row = value as Record<string, unknown>;
  if (required.some(key => !Object.hasOwn(row, key)) || Object.keys(row).some(key => !required.includes(key) && !optional.includes(key))) return fail();
  return row;
}
function id(value: unknown): string {try {return catalogOperationId(value);} catch {return fail();}}
export function decodeAgentWritingCompactionPrepareRequest(value: unknown): AgentWritingCompactionPrepareRequest {
  const row = fields(value, ["request", "expectedRevision"]);
  if (typeof row.expectedRevision !== "number" || !Number.isSafeInteger(row.expectedRevision) || row.expectedRevision < 0) return fail();
  return {request: decodeAgentWritingPrepareRequest(row.request), expectedRevision: row.expectedRevision};
}
export function sameAgentWritingPrepareRequest(a: AgentWritingPrepareRequest, b: AgentWritingPrepareRequest): boolean {
  return JSON.stringify(decodeAgentWritingPrepareRequest(a)) === JSON.stringify(decodeAgentWritingPrepareRequest(b));
}
export function sameAgentWritingCompactionPrepareRequest(a: AgentWritingCompactionPrepareRequest, b: AgentWritingCompactionPrepareRequest): boolean {
  return JSON.stringify(decodeAgentWritingCompactionPrepareRequest(a)) === JSON.stringify(decodeAgentWritingCompactionPrepareRequest(b));
}
function proof(value: unknown, intent: AgentWritingPrepareRequest): AgentWritingPrepareProof {
  const row = fields(value, ["schemaVersion", "operationId", "conversationId", "family", "epoch", "sqlFence", "replayed", "result"]);
  if (row.schemaVersion !== 1 || row.family !== AGENT_WRITING_PREPARE_FAMILY || row.result !== null || typeof row.replayed !== "boolean"
    || id(row.operationId) !== intent.requestId || id(row.conversationId) !== intent.conversationId) return fail();
  return {schemaVersion: 1, operationId: intent.requestId, conversationId: intent.conversationId, family: AGENT_WRITING_PREPARE_FAMILY,
    epoch: id(row.epoch), sqlFence: agentSqlFence(row.sqlFence), replayed: row.replayed, result: null};
}
function absent(status: Record<string, unknown>, intent: AgentWritingPrepareRequest): Absent {
  if (status.type === "notFound") {fields(status, ["type"]); return {type: "notFound"};}
  if (status.type !== "unconfirmed") return fail();
  fields(status, ["type", "detail"]);
  const detail = fields(status.detail, ["operationId", "epoch", "sqlFence", "phase", "sqliteCode", "sqliteExtendedCode", "safeCause"]);
  const value = decodeAgentSqlImmediateFailure({code: "DATA_SQL_RECOVERY_REQUIRED", reason: detail})?.diagnostic;
  if (!value || id(value.operationId) !== intent.requestId || !value.phase || !value.safeCause
    || ["epoch", "sqlFence", "sqliteCode", "sqliteExtendedCode"].some(key => !Object.hasOwn(value, key))) return fail();
  return {type: "unconfirmed", detail: {...value, operationId: intent.requestId, phase: value.phase, safeCause: value.safeCause}};
}
export function decodeAgentWritingPrepareResult(value: unknown, intent: Pick<AgentWritingPrepareRequest, "conversationId" | "requestId" | "context">): AgentSubmissionPreview {
  const preview = decodeAgentSubmissionPreview(value);
  if (preview.conversationId !== intent.conversationId || preview.requestId !== intent.requestId || preview.manuscriptId !== intent.context.manuscriptId) return fail();
  if (!preview.input.context.length) return fail();
  for (const source of preview.input.context) {
    if (source.anchor === null) return fail();
    let anchor: Record<string, unknown>;
    try {const value: unknown = JSON.parse(source.anchor); if (!value || typeof value !== "object" || Array.isArray(value)) return fail(); anchor = value as Record<string, unknown>;} catch {return fail();}
    if (source.kind === "manuscript" && anchor.manuscriptId === preview.manuscriptId) continue;
    if (source.kind === "retrieval" && anchor.manuscriptId === preview.manuscriptId && typeof anchor.traceId === "string"
      && source.sourceId === `retrieval:${anchor.traceId}` && source.revision === `trace:${anchor.traceId}`) continue;
    if (anchor.supplementalContext === true) {
      if (anchor.content !== "resourceGrant" || (anchor.contextAccess !== "readOnly" && anchor.contextAccess !== "readWrite")) return fail();
      const resource = decodeAgentContextResource(anchor.resource);
      const kind = resource.kind === "note" || resource.kind === "noteGroup" ? "note" : resource.kind === "manuscript" || resource.kind === "manuscriptFile" ? "manuscript" : "paper";
      const resourceId = resource.kind === "manuscriptFile" ? resource.path : resource.resourceId;
      if (source.kind !== kind || source.resourceId !== resourceId || !/^resource:[a-f0-9]{64}$/u.test(source.sourceId)
        || source.revision !== `grant:${source.sourceId.slice(9)}`) return fail();
      continue;
    }
    return fail();
  }
  return preview;
}
export function decodeAgentWritingPrepareStatusResponse(value: unknown): AgentWritingPrepareStatusResponse {
  const row = fields(value, ["schemaVersion", "intent", "status"]); if (row.schemaVersion !== 1) return fail();
  const intent = decodeAgentWritingPrepareRequest(row.intent), status = fields(row.status, ["type"], ["result", "proof", "detail"]);
  if (status.type !== "committed") return {schemaVersion: 1, intent, status: absent(status, intent)};
  fields(status, ["type", "proof", "result"]);
  return {schemaVersion: 1, intent, status: {type: "committed", proof: proof(status.proof, intent), result: decodeAgentWritingPrepareResult(status.result, intent)}};
}
export function decodeAgentWritingCompactionPrepareStatusResponse(value: unknown): AgentWritingCompactionPrepareStatusResponse {
  const row = fields(value, ["schemaVersion", "intent", "status"]); if (row.schemaVersion !== 1) return fail();
  const intent = decodeAgentWritingCompactionPrepareRequest(row.intent), status = fields(row.status, ["type"], ["result", "proof", "detail"]);
  if (status.type !== "committed") return {schemaVersion: 1, intent, status: absent(status, intent.request)};
  fields(status, ["type", "proof", "result"]); const result = decodeAgentWritingCompactionPreview(status.result);
  decodeAgentWritingPrepareResult(result.preview, intent.request);
  if (result.expectedRevision !== intent.expectedRevision) return fail();
  return {schemaVersion: 1, intent, status: {type: "committed", proof: proof(status.proof, intent.request), result}};
}
