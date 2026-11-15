import { catalogOperationId, agentSqlFence } from "./catalogOperationDecoding";
import { decodeAgentContextResource } from "./contextSelection";
import { decodeAgentRetrievalSelection } from "./retrieval";
import { decodeAgentRequestUserInput as input } from "./requestUserInput";
import { decodeAgentSqlImmediateFailure } from "./sqlImmediateDiagnostic";
import type { AgentWritingQueueCancelDiagnostic } from "./queuePreviewCancellation";
import { AgentSubmissionDecodeError, decodeAgentInstructionConfigOverride, decodeAgentWritingQueuePreview,
  type AgentWritingPrepareRequest, type AgentWritingQueuePreviewRequest, type AgentWritingQueuePreviewResponse } from "./submission";

export const AGENT_QUEUE_PREVIEW_PREPARE_FAMILY = "agent.queue.preview.prepare";
export interface AgentWritingQueuePrepareProof {
  readonly schemaVersion: 1; readonly operationId: string; readonly conversationId: string;
  readonly family: typeof AGENT_QUEUE_PREVIEW_PREPARE_FAMILY;
  readonly epoch: string; readonly sqlFence: string; readonly replayed: boolean; readonly result: null;
}
export interface AgentWritingQueuePrepareStatusResponse {
  readonly schemaVersion: 1;
  readonly intent: AgentWritingQueuePreviewRequest;
  readonly status: {readonly type: "committed"; readonly proof: AgentWritingQueuePrepareProof; readonly result: AgentWritingQueuePreviewResponse}
    | {readonly type: "notFound"} | {readonly type: "unconfirmed"; readonly detail: AgentWritingQueueCancelDiagnostic};
}
function fail(): never { throw new AgentSubmissionDecodeError(); }
function fields(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const row = value as Record<string, unknown>;
  if (required.some(key => !Object.hasOwn(row, key)) || Object.keys(row).some(key => !required.includes(key) && !optional.includes(key))) return fail();
  return row;
}
function id(value: unknown): string { try {return catalogOperationId(value);} catch {return fail();} }
function text(value: unknown): string {return typeof value === "string" ? value : fail();}
function revision(value: unknown): number {return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : fail();}
export function decodeNativeAgentContextResource(value: unknown): ReturnType<typeof decodeAgentContextResource> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const row = {...value} as Record<string, unknown>;
  const optional = row.kind === "paper" ? ["attachmentId", "pageIndex"] : ["structuredObject", "templateCatalog"].includes(String(row.kind)) ? ["access"]
    : ["paperGroup", "manuscript", "noteGroup"].includes(String(row.kind)) ? ["groupAccess", "newMemberAccess"] : [];
  for (const key of optional) if (row[key] === null) delete row[key];
  if (row.kind === "note" || row.kind === "manuscriptFile") row.resourceId = id(row.resourceId);
  if (Array.isArray(row.parts)) row.parts = row.parts.map(value => {const part = fields(value, ["resource", "label", "selected", "access"]); return {...part, resource: decodeNativeAgentContextResource(part.resource)};});
  return decodeAgentContextResource(row);
}
/** Native serde defaults are canonicalized before persistence and comparison.
 * This does not resolve sources, select model policy or materialize a preview. */
export function decodeAgentWritingPrepareRequest(value: unknown): AgentWritingPrepareRequest {
  const row = fields(value, ["conversationId", "requestId", "text", "context"], ["userInput", "resources", "retrieval", "model", "sessionConfig", "turnConfig"]);
  const context = fields(row.context, ["manuscriptId", "files"]);
  if (!Array.isArray(context.files) || (row.resources !== undefined && !Array.isArray(row.resources))) return fail();
  const files = context.files.map(value => {
    const file = fields(value, ["relativePath", "expectedDiskSha256"], ["buffer", "selection"]);
    const buffer = file.buffer == null ? null : fields(file.buffer, ["revision", "text"]);
    const selection = file.selection == null ? null : fields(file.selection, ["startUtf16", "endUtf16"]);
    return {relativePath: text(file.relativePath), expectedDiskSha256: text(file.expectedDiskSha256),
      buffer: buffer && {revision: id(buffer.revision), text: text(buffer.text)},
      selection: selection && {startUtf16: revision(selection.startUtf16), endUtf16: revision(selection.endUtf16)}};
  });
  const model = row.model == null ? null : fields(row.model, ["providerId", "modelId"], ["reasoningEffort", "serviceTier"]);
  if (model?.serviceTier != null && model.serviceTier !== "fast" && model.serviceTier !== "default") return fail();
  const message = text(row.text);
  return {conversationId: id(row.conversationId), requestId: id(row.requestId), text: message,
    userInput: input(row.userInput, message), resources: (row.resources as unknown[] | undefined ?? []).map(decodeNativeAgentContextResource),
    context: {manuscriptId: id(context.manuscriptId), files},
    retrieval: row.retrieval == null ? null : decodeAgentRetrievalSelection(row.retrieval),
    model: model && {providerId: text(model.providerId), modelId: text(model.modelId), reasoningEffort: model.reasoningEffort == null ? null : text(model.reasoningEffort),
      serviceTier: model.serviceTier == null ? null : model.serviceTier as "fast" | "default"},
    sessionConfig: decodeAgentInstructionConfigOverride(row.sessionConfig), turnConfig: decodeAgentInstructionConfigOverride(row.turnConfig)};
}
export function decodeAgentWritingQueuePreviewRequest(value: unknown): AgentWritingQueuePreviewRequest {
  const row = fields(value, ["inputId", "expectedRevision", "submission"]), expectedRevision = revision(row.expectedRevision);
  if (expectedRevision >= Number.MAX_SAFE_INTEGER) return fail();
  return {inputId: id(row.inputId), expectedRevision, submission: decodeAgentWritingPrepareRequest(row.submission)};
}
export function sameAgentWritingQueuePreviewRequest(a: AgentWritingQueuePreviewRequest, b: AgentWritingQueuePreviewRequest): boolean {
  return JSON.stringify(decodeAgentWritingQueuePreviewRequest(a)) === JSON.stringify(decodeAgentWritingQueuePreviewRequest(b));
}
export function decodeAgentWritingQueuePrepareResult(value: unknown, intent: AgentWritingQueuePreviewRequest): AgentWritingQueuePreviewResponse {
  const result = decodeAgentWritingQueuePreview(value), request = intent.submission;
  if (result.inputId !== intent.inputId || result.preview.requestId !== request.requestId || result.preview.input.text !== request.text
    || result.preview.conversationId !== request.conversationId || result.preview.manuscriptId !== request.context.manuscriptId
    || result.queue.revision !== intent.expectedRevision + 1 || result.queue.preparingInputId !== intent.inputId) return fail();
  return result;
}
export function decodeAgentWritingQueuePrepareStatusResponse(value: unknown): AgentWritingQueuePrepareStatusResponse {
  const row = fields(value, ["schemaVersion", "intent", "status"]);
  if (row.schemaVersion !== 1) return fail();
  const intent = decodeAgentWritingQueuePreviewRequest(row.intent), status = fields(row.status, ["type"], ["proof", "result", "detail"]);
  if (status.type === "notFound") {fields(status, ["type"]); return {schemaVersion: 1, intent, status: {type: "notFound"}};}
  if (status.type === "committed") {
    fields(status, ["type", "proof", "result"]);
    const proof = fields(status.proof, ["schemaVersion", "operationId", "conversationId", "family", "epoch", "sqlFence", "replayed", "result"]);
    if (proof.schemaVersion !== 1 || proof.family !== AGENT_QUEUE_PREVIEW_PREPARE_FAMILY || proof.result !== null || typeof proof.replayed !== "boolean"
      || id(proof.operationId) !== intent.submission.requestId || id(proof.conversationId) !== intent.submission.conversationId) return fail();
    return {schemaVersion: 1, intent, status: {type: "committed", result: decodeAgentWritingQueuePrepareResult(status.result, intent),
      proof: {schemaVersion: 1, family: AGENT_QUEUE_PREVIEW_PREPARE_FAMILY, operationId: intent.submission.requestId,
        conversationId: intent.submission.conversationId, epoch: id(proof.epoch), sqlFence: agentSqlFence(proof.sqlFence), replayed: proof.replayed, result: null}}};
  }
  if (status.type === "unconfirmed") {
    fields(status, ["type", "detail"]);
    const detail = fields(status.detail, ["operationId", "epoch", "sqlFence", "phase", "sqliteCode", "sqliteExtendedCode", "safeCause"]);
    const diagnostic = decodeAgentSqlImmediateFailure({code: "DATA_SQL_RECOVERY_REQUIRED", reason: detail})?.diagnostic;
    if (!diagnostic || id(diagnostic.operationId) !== intent.submission.requestId || !diagnostic.phase || !diagnostic.safeCause) return fail();
    return {schemaVersion: 1, intent, status: {type: "unconfirmed", detail: {...diagnostic, operationId: intent.submission.requestId, phase: diagnostic.phase, safeCause: diagnostic.safeCause}}};
  }
  return fail();
}
