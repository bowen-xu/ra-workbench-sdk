import {decodeAgentUserInput, type AgentUserInput} from "./userInput";
import { decodeAgentNoteContextPreview, decodeAgentNoteContextRequest, type AgentNoteContextRequest } from "./noteContext";
import { validateNoteInstructionProfile } from "./noteInstructionProfile";
import { decodeAgentRetrievalSelection, type AgentRetrievalSelection } from "./retrieval";
import { decodeAgentModelSelection, decodeAgentSubmissionInput, decodeAgentSubmissionText,
  decodeAgentInstructionConfigOverride, type AgentInstructionConfigOverride, type AgentModelSelection, type AgentSubmissionInput } from "./submission";

export interface AgentNoteReceipt {
  readonly conversationId: string;
  readonly requestId: string;
  readonly pageId: string;
}
export interface AgentNotePrepareRequest {
  readonly conversationId: string;
  readonly requestId: string;
  readonly text: string;
  readonly userInput?: readonly AgentUserInput[];
  readonly context: AgentNoteContextRequest;
  readonly retrieval?: AgentRetrievalSelection | null;
  readonly model?: AgentModelSelection | null;
  readonly sessionConfig?: AgentInstructionConfigOverride | null;
  readonly turnConfig?: AgentInstructionConfigOverride | null;
}
export interface AgentNoteSubmissionPreview extends AgentNoteReceipt {
  readonly schemaVersion: 1;
  readonly turnId: string;
  readonly contextSnapshotId: string;
  readonly input: AgentSubmissionInput;
}
export class AgentNoteSubmissionDecodeError extends Error {
  constructor() { super("Invalid or mismatched note submission"); this.name = "AgentNoteSubmissionDecodeError"; }
}
function fail(): never { throw new AgentNoteSubmissionDecodeError(); }
function row(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const result = value as Record<string, unknown>;
  if (Object.keys(result).length !== keys.length || keys.some(key => !Object.hasOwn(result, key))) return fail();
  return result;
}
function uuid(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)
    || value === "00000000-0000-0000-0000-000000000000") return fail();
  return value.toLowerCase();
}
function identity(value: unknown, maxBytes: number): string {
  if (typeof value !== "string" || !value.trim() || value.includes("\0") || value.length > maxBytes) return fail();
  return value;
}
export function decodeAgentNoteReceipt(value: unknown): AgentNoteReceipt {
  const receipt = row(value, ["conversationId", "requestId", "pageId"]);
  return { conversationId: uuid(receipt.conversationId), requestId: uuid(receipt.requestId), pageId: uuid(receipt.pageId) };
}
export function decodeAgentNotePrepareRequest(value: unknown): AgentNotePrepareRequest {
  try {
    const optionalModel = !!value && typeof value === "object" && Object.hasOwn(value, "model");
    const optionalSession = !!value && typeof value === "object" && Object.hasOwn(value, "sessionConfig");
    const optionalTurn = !!value && typeof value === "object" && Object.hasOwn(value, "turnConfig");
    const hasRetrieval = !!value && typeof value === "object" && Object.hasOwn(value, "retrieval");
    const request = row(value, ["conversationId", "requestId", "text", "context", ...(optionalModel ? ["model"] : []), ...(hasRetrieval ? ["retrieval"] : []), ...(optionalSession ? ["sessionConfig"] : []), ...(optionalTurn ? ["turnConfig"] : []), ...((value as {userInput?: unknown}).userInput !== undefined ? ["userInput"] : [])]);
    const retrieval = request.retrieval == null ? request.retrieval : decodeAgentRetrievalSelection(request.retrieval);
    return { conversationId: uuid(request.conversationId), requestId: uuid(request.requestId),
      text: decodeAgentSubmissionText(request.text), ...(request.userInput !== undefined ? {userInput: decodeAgentUserInput(request.userInput, decodeAgentSubmissionText(request.text))} : {}), context: decodeAgentNoteContextRequest(request.context),
      model: decodeAgentModelSelection(request.model),
      ...(hasRetrieval ? { retrieval: retrieval ?? null } : {}),
      ...(optionalSession ? { sessionConfig: decodeAgentInstructionConfigOverride(request.sessionConfig) } : {}),
      ...(optionalTurn ? { turnConfig: decodeAgentInstructionConfigOverride(request.turnConfig) } : {}) };
  } catch { return fail(); }
}

/** Decode original evidence, including restored revisions; no current editor state. */
export function decodeAgentNoteSubmissionPreview(value: unknown): AgentNoteSubmissionPreview {
  try {
    const preview = row(value, ["schemaVersion", "conversationId", "requestId", "pageId", "turnId", "contextSnapshotId", "input"]);
    if (preview.schemaVersion !== 1) return fail();
    const receipt = decodeAgentNoteReceipt({ conversationId: preview.conversationId, requestId: preview.requestId, pageId: preview.pageId });
    const input = decodeAgentSubmissionInput(preview.input);
    const source = input.context.find(item => item.kind === "note");
    if (!source || source.anchor === null || input.context.some(item => item.kind !== "note" && item.kind !== "retrieval")) return fail();
    validateNoteInstructionProfile(input, "note", receipt.pageId);
    const anchor = row(JSON.parse(source.anchor), ["schemaVersion", "pageId", "pageRevision", "blockId"]);
    const selection = decodeAgentNoteContextRequest({ pageId: receipt.pageId, expectedRevision: anchor.pageRevision, blockId: anchor.blockId });
    decodeAgentNoteContextPreview({ schemaVersion: 1, source }, selection);
    const retrievals = input.context.filter(item => item.kind === "retrieval");
    if (retrievals.length > 1) return fail();
    for (const retrieval of retrievals) {
      const anchor = row(JSON.parse(retrieval.anchor ?? "null"), ["pageId", "traceId", "query"]);
      if (anchor.pageId !== receipt.pageId || retrieval.resourceId !== receipt.pageId || retrieval.revision !== `trace:${anchor.traceId}` || retrieval.sourceId !== `retrieval:${anchor.traceId}`) return fail();
      identity(anchor.traceId, 160); identity(anchor.query, 16_384);
    }
    return { schemaVersion: 1, ...receipt, turnId: uuid(preview.turnId), contextSnapshotId: uuid(preview.contextSnapshotId), input };
  } catch { return fail(); }
}
