import {decodeAgentUserInput, type AgentUserInput} from "./userInput";
import { row, utf8Length } from "./workspaceDecoding";
import { validateApplicationSkills } from "./skills";
import { decodeAgentRetrievalSelection, type AgentRetrievalSelection } from "./retrieval";
import { decodeAgentModelSelection, decodeAgentSubmissionInput, decodeAgentSubmissionText,
  decodeAgentQueuedText, decodeAgentSteerResponse,
  decodeAgentInstructionConfigOverride, type AgentInstructionConfigOverride, type AgentModelSelection, type AgentSubmissionInput, type AgentSteerResponse } from "./submission";

export interface AgentPaperSubmissionReceipt {
  readonly conversationId: string;
  readonly requestId: string;
  readonly paperId: string;
  readonly paperContextSnapshotId: string;
}
export interface AgentPaperSubmissionPrepareRequest {
  readonly conversationId: string;
  readonly requestId: string;
  readonly paperId: string;
  readonly paperContextSnapshotId: string;
  readonly expectedContextHash: string;
  readonly retrieval?: AgentRetrievalSelection | null;
  readonly text: string;
  readonly userInput?: readonly AgentUserInput[];
  readonly model?: AgentModelSelection | null;
  readonly sessionConfig?: AgentInstructionConfigOverride | null;
  readonly turnConfig?: AgentInstructionConfigOverride | null;
}
export interface AgentPaperSubmissionPreview extends AgentPaperSubmissionReceipt {
  readonly schemaVersion: 1;
  readonly turnId: string;
  readonly contextSnapshotId: string;
  readonly input: AgentSubmissionInput;
}
export interface AgentPaperSteerRequest {
  readonly conversationId: string;
  readonly paperId: string;
  readonly turnId: string;
  readonly inputId: string;
  readonly text: string;
  readonly userInput?: readonly AgentUserInput[];
}
export type AgentPaperSteerResponse = AgentSteerResponse;
export interface AgentPaperTurnSourcesRequest {
  readonly conversationId: string;
  readonly paperId: string;
  readonly turnId: string;
}
export interface AgentPaperTurnSourceRegion {
  readonly pageIndex: number;
  readonly rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
}
export interface AgentPaperTurnSource {
  readonly sourceId: string;
  readonly id: string;
  readonly attachmentId: string;
  readonly regions: readonly AgentPaperTurnSourceRegion[];
}
export interface AgentPaperTurnSourcesResponse {
  readonly schemaVersion: 1;
  readonly conversationId: string;
  readonly paperId: string;
  readonly turnId: string;
  readonly sources: readonly AgentPaperTurnSource[];
  readonly retrievalTraceId?: string;
}
export class AgentPaperSubmissionDecodeError extends Error {
  constructor() { super("Invalid or mismatched paper submission"); this.name = "AgentPaperSubmissionDecodeError"; }
}
function fail(): never { throw new AgentPaperSubmissionDecodeError(); }
function uuid(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)
    || value === "00000000-0000-0000-0000-000000000000") return fail();
  return value.toLowerCase();
}
function identity(value: unknown, max = 1024): string {
  if (typeof value !== "string" || !value.trim() || utf8Length(value) > max || /[\u0000-\u001f\u007f-\u009f]/.test(value)) return fail();
  return value;
}
function hash(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) return fail();
  return value;
}
function receipt(value: unknown): AgentPaperSubmissionReceipt {
  const r = row(value, ["conversationId", "requestId", "paperId", "paperContextSnapshotId"]);
  return { conversationId: uuid(r.conversationId), requestId: uuid(r.requestId), paperId: identity(r.paperId), paperContextSnapshotId: identity(r.paperContextSnapshotId) };
}
export function decodeAgentPaperSubmissionReceipt(value: unknown): AgentPaperSubmissionReceipt {
  try { return receipt(value); } catch { return fail(); }
}
export function decodeAgentPaperSteerRequest(value: unknown): AgentPaperSteerRequest {
  try {
    const r = row(value, ["conversationId", "paperId", "turnId", "inputId", "text", ...((value as {userInput?: unknown}).userInput !== undefined ? ["userInput"] : [])]);
    return { conversationId: uuid(r.conversationId), paperId: identity(r.paperId), turnId: uuid(r.turnId), inputId: uuid(r.inputId), text: decodeAgentQueuedText(r.text), ...(r.userInput !== undefined ? {userInput: decodeAgentUserInput(r.userInput, decodeAgentQueuedText(r.text))} : {}) };
  } catch { return fail(); }
}
export const decodeAgentPaperSteerResponse = decodeAgentSteerResponse;
export function decodeAgentPaperTurnSourcesRequest(value: unknown): AgentPaperTurnSourcesRequest {
  try {
    const r = row(value, ["conversationId", "paperId", "turnId"]);
    return { conversationId: uuid(r.conversationId), paperId: identity(r.paperId), turnId: uuid(r.turnId) };
  } catch { return fail(); }
}
function sourceRegion(value: unknown): AgentPaperTurnSourceRegion {
  const region = row(value, ["pageIndex", "rect"]), rect = row(region.rect, ["x", "y", "width", "height"]);
  const values = [rect.x, rect.y, rect.width, rect.height];
  if (!values.every((entry): entry is number => typeof entry === "number" && Number.isFinite(entry))
    || typeof region.pageIndex !== "number" || !Number.isSafeInteger(region.pageIndex) || region.pageIndex < 0
    || (values[0] as number) < 0 || (values[1] as number) < 0 || (values[2] as number) <= 0 || (values[3] as number) <= 0
    || (values[0] as number) + (values[2] as number) > 1.000001 || (values[1] as number) + (values[3] as number) > 1.000001) return fail();
  const x = values[0] as number;
  const y = values[1] as number;
  const width = values[2] as number;
  const height = values[3] as number;
  return { pageIndex: region.pageIndex, rect: { x, y, width, height } };
}
export function decodeAgentPaperTurnSourcesResponse(value: unknown, expected: AgentPaperTurnSourcesRequest): AgentPaperTurnSourcesResponse {
  try {
    const request = decodeAgentPaperTurnSourcesRequest(expected);
    const hasRetrievalTrace = !!value && typeof value === "object" && Object.hasOwn(value, "retrievalTraceId");
    const r = row(value, ["schemaVersion", "conversationId", "paperId", "turnId", "sources", ...(hasRetrievalTrace ? ["retrievalTraceId"] : [])]);
    if (r.schemaVersion !== 1 || uuid(r.conversationId) !== request.conversationId || identity(r.paperId) !== request.paperId
      || uuid(r.turnId) !== request.turnId || !Array.isArray(r.sources) || r.sources.length > 20_000) return fail();
    const retrievalTraceId = r.retrievalTraceId === undefined ? undefined : identity(r.retrievalTraceId, 160);
    const sources = r.sources.map((value) => {
      const source = row(value, ["sourceId", "id", "attachmentId", "regions"]);
      if (typeof source.sourceId !== "string" || !/^paper-source:[0-9a-f]{64}$/.test(source.sourceId)
        || !Array.isArray(source.regions) || source.regions.length > 20_000) return fail();
      return { sourceId: source.sourceId, id: identity(source.id, 80), attachmentId: identity(source.attachmentId), regions: source.regions.map(sourceRegion) };
    });
    if (new Set(sources.map((source) => source.sourceId)).size !== sources.length) return fail();
    return { schemaVersion: 1, conversationId: request.conversationId, paperId: request.paperId, turnId: request.turnId, sources, ...(retrievalTraceId === undefined ? {} : { retrievalTraceId }) };
  } catch { return fail(); }
}
export function decodeAgentPaperSubmissionPrepareRequest(value: unknown): AgentPaperSubmissionPrepareRequest {
  try {
    const optional = !!value && typeof value === "object" && Object.hasOwn(value, "model");
    const hasRetrieval = !!value && typeof value === "object" && Object.hasOwn(value, "retrieval");
    const hasSession = !!value && typeof value === "object" && Object.hasOwn(value, "sessionConfig");
    const hasTurn = !!value && typeof value === "object" && Object.hasOwn(value, "turnConfig");
    const r = row(value, ["conversationId", "requestId", "paperId", "paperContextSnapshotId", "expectedContextHash", "text", ...(optional ? ["model"] : []), ...(hasRetrieval ? ["retrieval"] : []), ...(hasSession ? ["sessionConfig"] : []), ...(hasTurn ? ["turnConfig"] : []), ...((value as {userInput?: unknown}).userInput !== undefined ? ["userInput"] : [])]);
    let retrieval: AgentPaperSubmissionPrepareRequest["retrieval"];
    if (r.retrieval === null || r.retrieval === undefined) retrieval = r.retrieval;
    else {
      retrieval = decodeAgentRetrievalSelection(r.retrieval);
    }
    return { conversationId: uuid(r.conversationId), requestId: uuid(r.requestId), paperId: identity(r.paperId),
      paperContextSnapshotId: identity(r.paperContextSnapshotId), expectedContextHash: hash(r.expectedContextHash),
      text: decodeAgentSubmissionText(r.text), ...(r.userInput !== undefined ? {userInput: decodeAgentUserInput(r.userInput, decodeAgentSubmissionText(r.text))} : {}), model: decodeAgentModelSelection(r.model),
      ...(retrieval === undefined ? {} : { retrieval }),
      ...(hasSession ? { sessionConfig: decodeAgentInstructionConfigOverride(r.sessionConfig) } : {}),
      ...(hasTurn ? { turnConfig: decodeAgentInstructionConfigOverride(r.turnConfig) } : {}) };
  } catch { return fail(); }
}
function validatePreviewAnchor(value: string, paper: AgentPaperSubmissionReceipt): void {
  const anchor = row(JSON.parse(value), ["paperId", "snapshotId", "attachmentId", "parseRunId", "kind", "rawRef", "pageIndex"]);
  if (anchor.paperId !== paper.paperId || anchor.snapshotId !== paper.paperContextSnapshotId) return fail();
  identity(anchor.attachmentId); identity(anchor.parseRunId); identity(anchor.kind, 80); identity(anchor.rawRef);
  if (anchor.pageIndex !== null && (!Number.isSafeInteger(anchor.pageIndex) || (anchor.pageIndex as number) < 0)) return fail();
}
function validateRetrievalAnchor(value: string, paper: AgentPaperSubmissionReceipt, sourceId: string): void {
  const anchor = row(JSON.parse(value), ["paperId", "snapshotId", "traceId", "query"]);
  if (anchor.paperId !== paper.paperId || anchor.snapshotId !== paper.paperContextSnapshotId
    || typeof anchor.traceId !== "string" || sourceId !== `retrieval:${anchor.traceId}`) return fail();
  identity(anchor.traceId, 160); identity(anchor.query, 16_384);
}
export function decodeAgentPaperSubmissionPreview(value: unknown): AgentPaperSubmissionPreview {
  try {
    const preview = row(value, ["schemaVersion", "conversationId", "requestId", "paperId", "paperContextSnapshotId", "turnId", "contextSnapshotId", "input"]);
    if (preview.schemaVersion !== 1) return fail();
    const scope = receipt({ conversationId: preview.conversationId, requestId: preview.requestId, paperId: preview.paperId, paperContextSnapshotId: preview.paperContextSnapshotId });
    const input = decodeAgentSubmissionInput(preview.input);
    validateApplicationSkills(input.skills);
    // Image references are held by the native submission, not repeated in this preview.
    if (input.context.some(source =>
      (source.kind !== "paper" && source.kind !== "retrieval") || source.resourceId !== scope.paperId || source.anchor === null)) return fail();
    input.context.forEach(source => source.kind === "paper"
      ? validatePreviewAnchor(source.anchor!, scope)
      : validateRetrievalAnchor(source.anchor!, scope, source.sourceId));
    return { schemaVersion: 1, ...scope, turnId: uuid(preview.turnId), contextSnapshotId: uuid(preview.contextSnapshotId), input };
  } catch { return fail(); }
}
