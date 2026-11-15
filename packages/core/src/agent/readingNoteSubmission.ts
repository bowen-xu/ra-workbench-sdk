import {decodeAgentUserInput, type AgentUserInput} from "./userInput";
import { id, row } from "./workspaceDecoding";
import { validateNoteInstructionProfile } from "./noteInstructionProfile";
import { decodeAgentRetrievalSelection, type AgentRetrievalSelection } from "./retrieval";
import { decodeAgentReadingNoteContextRequest, decodeAgentReadingNoteContextPreview, type AgentReadingNoteContextRequest } from "./readingNoteContext";
import { decodeAgentInstructionConfigOverride, decodeAgentModelSelection, decodeAgentSubmissionInput, decodeAgentSubmissionText, type AgentInstructionConfigOverride, type AgentModelSelection, type AgentSubmissionInput } from "./submission";

export interface AgentReadingNoteReceipt { readonly conversationId: string; readonly requestId: string; readonly readingNoteId: string; }
export interface AgentReadingNotePrepareRequest {
  readonly conversationId: string; readonly requestId: string; readonly text: string;
  readonly userInput?: readonly AgentUserInput[];
  readonly context: AgentReadingNoteContextRequest; readonly retrieval?: AgentRetrievalSelection | null; readonly model?: AgentModelSelection | null;
  readonly sessionConfig?: AgentInstructionConfigOverride | null; readonly turnConfig?: AgentInstructionConfigOverride | null;
}
export interface AgentReadingNoteSubmissionPreview extends AgentReadingNoteReceipt {
  readonly schemaVersion: 1; readonly turnId: string; readonly contextSnapshotId: string; readonly input: AgentSubmissionInput;
}
export function decodeAgentReadingNoteReceipt(value: unknown): AgentReadingNoteReceipt {
  const r = row(value, ["conversationId", "requestId", "readingNoteId"]);
  return {conversationId: id(r.conversationId), requestId: id(r.requestId), readingNoteId: id(r.readingNoteId)};
}
export function decodeAgentReadingNotePrepareRequest(value: unknown): AgentReadingNotePrepareRequest {
  const hasModel = !!value && typeof value === "object" && Object.hasOwn(value, "model");
  const hasRetrieval = !!value && typeof value === "object" && Object.hasOwn(value, "retrieval");
  const hasSession = !!value && typeof value === "object" && Object.hasOwn(value, "sessionConfig");
  const hasTurn = !!value && typeof value === "object" && Object.hasOwn(value, "turnConfig");
  const r = row(value, ["conversationId", "requestId", "text", "context", ...(hasModel ? ["model"] : []), ...(hasRetrieval ? ["retrieval"] : []), ...(hasSession ? ["sessionConfig"] : []), ...(hasTurn ? ["turnConfig"] : []), ...((value as {userInput?: unknown}).userInput !== undefined ? ["userInput"] : [])]);
  const retrieval = r.retrieval == null ? r.retrieval : decodeAgentRetrievalSelection(r.retrieval);
  return {conversationId: id(r.conversationId), requestId: id(r.requestId), text: decodeAgentSubmissionText(r.text), ...(r.userInput !== undefined ? {userInput: decodeAgentUserInput(r.userInput, decodeAgentSubmissionText(r.text))} : {}),
    context: decodeAgentReadingNoteContextRequest(r.context), ...(hasRetrieval ? {retrieval: retrieval ?? null} : {}), model: decodeAgentModelSelection(r.model),
    ...(hasSession ? {sessionConfig: decodeAgentInstructionConfigOverride(r.sessionConfig)} : {}),
    ...(hasTurn ? {turnConfig: decodeAgentInstructionConfigOverride(r.turnConfig)} : {})};
}
/** Restore validates frozen evidence; the current note/model are deliberately absent. */
export function decodeAgentReadingNoteSubmissionPreview(value: unknown): AgentReadingNoteSubmissionPreview {
  const r = row(value, ["schemaVersion", "conversationId", "requestId", "readingNoteId", "turnId", "contextSnapshotId", "input"]);
  if (r.schemaVersion !== 1) throw new Error("Invalid reading note submission version");
  const receipt = decodeAgentReadingNoteReceipt({conversationId: r.conversationId, requestId: r.requestId, readingNoteId: r.readingNoteId});
  const input = decodeAgentSubmissionInput(r.input), source = input.context.find(item => item.kind === "note");
  if (!source || !source.anchor || input.context.some(item => item.kind !== "note" && item.kind !== "retrieval")) throw new Error("Invalid reading note submission scope");
  validateNoteInstructionProfile(input, "readingNote", receipt.readingNoteId);
  const anchor = JSON.parse(source.anchor);
  decodeAgentReadingNoteContextPreview({schemaVersion: 1, source}, {readingNoteId: receipt.readingNoteId, expectedRevision: anchor?.noteRevision});
  const retrievals = input.context.filter(item => item.kind === "retrieval");
  if (retrievals.length > 1) throw new Error("Invalid retrieval scope");
  for (const retrieval of retrievals) {
    const a = JSON.parse(retrieval.anchor ?? "null");
    if (!a || Object.keys(a).length !== 3 || a.readingNoteId !== receipt.readingNoteId || retrieval.resourceId !== receipt.readingNoteId || retrieval.revision !== `trace:${a.traceId}` || retrieval.sourceId !== `retrieval:${a.traceId}`) throw new Error("Invalid retrieval scope");
    decodeAgentRetrievalSelection({ traceId: a.traceId, query: a.query });
  }
  return {schemaVersion: 1, ...receipt, turnId: id(r.turnId), contextSnapshotId: id(r.contextSnapshotId), input};
}
