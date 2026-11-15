import {decodeAgentUserInput, decodeAgentSkillInstructions, sameAgentSkillIdentity, type AgentUserInput, type AgentSkillInstructions} from "./userInput";
import type {AgentConversationBinding} from "./catalog";
import { isAgentPaperQueueId } from "./paperQueueIdentity";
import { decodeSubmissionSkills, type AgentSubmissionSkill } from "./skills";
export type { AgentSubmissionSkill } from "./skills";
import { decodeInstructionConfigs, type AgentInstructionConfigSnapshot } from "./instructionConfig";
export type { AgentInstructionConfigSnapshot } from "./instructionConfig";
import type { AgentModelIdentity } from "./events";
import type { AgentRetrievalSelection } from "./retrieval";

export interface AgentModelSelection {
  readonly providerId: string;
  readonly modelId: string;
  readonly reasoningEffort?: string | null;
  readonly serviceTier?: "fast" | "default" | null;
}
export type AgentExecutionMode = "deepSeekNonThinking" | "chatGptDefault";

/**
 * Select the reviewed native execution profile for a frozen model choice.
 * Hosts use this only to label/submit the selected profile; native admission
 * remains authoritative and revalidates the same provider/model boundary.
 */
export function executionModeForModel(
  model: Pick<AgentModelSelection, "providerId" | "modelId">,
  reasoningEffort?: string | null,
): AgentExecutionMode | null {
  if (model.providerId === "deepseek"
    && (model.modelId === "deepseek-v4-pro" || model.modelId === "deepseek-v4-flash")
    && reasoningEffort == null) return "deepSeekNonThinking";
  if (model.providerId === "openai" && (model.modelId === "gpt-5.6-terra" || model.modelId === "gpt-5.6-sol")
    && (reasoningEffort == null || ["low", "medium", "high", "xhigh", "max"].includes(reasoningEffort))) return "chatGptDefault";
  return null;
}

export interface AgentWritingContextFile {
  readonly relativePath: string;
  readonly expectedDiskSha256: string;
  readonly buffer?: { readonly revision: string; readonly text: string } | null;
  readonly selection?: { readonly startUtf16: number; readonly endUtf16: number } | null;
}
export interface AgentInstructionConfigOverride {
  readonly maxBytes?: number | null;
  readonly fallbackFilenames?: readonly string[] | null;
}
export interface AgentWritingPrepareRequest {
  readonly conversationId: string;
  readonly requestId: string;
  readonly text: string;
  readonly userInput?: readonly AgentUserInput[];
  readonly resources?: readonly import("./contextSelection").AgentContextResource[];
  readonly context: { readonly manuscriptId: string; readonly files: readonly AgentWritingContextFile[] };
  /** An already previewed, manuscript-scoped concept retrieval trace. */
  readonly retrieval?: AgentRetrievalSelection | null;
  readonly model?: AgentModelSelection | null;
  readonly sessionConfig?: AgentInstructionConfigOverride | null;
  readonly turnConfig?: AgentInstructionConfigOverride | null;
}
export interface AgentWritingReceipt {
  readonly conversationId: string;
  readonly requestId: string;
  readonly manuscriptId: string;
}
export interface AgentContextText {
  readonly sourceId: string;
  readonly kind: "manuscript" | "paper" | "note" | "retrieval" | "userResource";
  readonly resourceId: string;
  readonly revision: string;
  readonly anchor: string | null;
  readonly text: string;
}
export interface AgentInstructionFragment {
  readonly environmentId: string;
  readonly scopeId: string;
  readonly sourceId: string;
  readonly revision: string;
  readonly originalBytes: number;
  readonly text: string;
  readonly disposition: "included" | "truncated" | "empty" | "budgetExcluded";
}
export interface AgentSubmissionPreview extends AgentWritingReceipt {
  readonly schemaVersion: 1;
  readonly turnId: string;
  readonly contextSnapshotId: string;
  readonly input: AgentSubmissionInput;
}
export interface AgentSubmissionInput {
  readonly remoteCompactionV2?: boolean | null;
  readonly text: string;
  readonly userInput?: readonly AgentUserInput[];
  readonly skillInstructions?: readonly AgentSkillInstructions[];
  readonly model: AgentModelIdentity;
  readonly reasoningEffort: string | null;
  readonly serviceTier?: "fast" | "default";
  readonly context: readonly AgentContextText[];
  readonly instructions?: readonly AgentInstructionFragment[];
  readonly instructionConfigs?: readonly AgentInstructionConfigSnapshot[];
  readonly skills?: readonly AgentSubmissionSkill[];
}

export class AgentSubmissionDecodeError extends Error {
  constructor() { super("Invalid or unsupported agent submission preview"); this.name = "AgentSubmissionDecodeError"; }
}
function fail(): never { throw new AgentSubmissionDecodeError(); }
function utf8Bytes(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if (code >= 0xd800 && code <= 0xdfff) return fail();
    bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
  }
  return bytes;
}
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== keys.length || keys.some((key) => !Object.hasOwn(row, key))) return fail();
  return row;
}
function uuid(value: unknown): string {
  return typeof value === "string" && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value) ? value.toLowerCase() : fail();
}
function name(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.includes("\0") || utf8Bytes(value) > 1024) return fail();
  return value;
}
function modelName(value: unknown): string {
  const result = name(value);
  return [...result].length <= 256 ? result : fail();
}
function nullableName(value: unknown): string | null { return value === null ? null : name(value); }
function sourceAnchor(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !value.trim() || value.includes("\0") || utf8Bytes(value) > 65_536) return fail();
  return value;
}

export function decodeAgentInstructionConfigOverride(value: unknown): AgentInstructionConfigOverride | null {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const keys = Object.keys(value);
  if (keys.some((key) => key !== "maxBytes" && key !== "fallbackFilenames")) return fail();
  const row = value as Record<string, unknown>;
  const maxBytes = row.maxBytes === undefined ? null : row.maxBytes;
  if (maxBytes !== null && (typeof maxBytes !== "number" || !Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > 1_048_576)) return fail();
  const names = row.fallbackFilenames === undefined ? null : row.fallbackFilenames;
  if (names !== null && (!Array.isArray(names) || names.length > 64)) return fail();
  const fallbackFilenames = names === null ? null : names.map((filename) => {
    if (typeof filename !== "string" || utf8Bytes(filename) > 255 || filename === "." || filename === ".." || /[\\/:\u0000-\u001f\u007f-\u009f]/u.test(filename)) return fail();
    return filename;
  });
  return { maxBytes, fallbackFilenames };
}

export function decodeAgentSubmissionText(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || utf8Bytes(value) > 1_048_576) return fail();
  return value;
}
function decodeServiceTier(row: Record<string, unknown>, providerId: unknown): { readonly serviceTier?: "fast" | "default" } {
  if (!Object.hasOwn(row, "serviceTier")) return {};
  if (providerId !== "openai" || (row.serviceTier !== "fast" && row.serviceTier !== "default")) return fail();
  return { serviceTier: row.serviceTier };
}

export function decodeAgentModelSelection(value: unknown): AgentModelSelection | null {
  if (value === null || value === undefined) return null;
  const hasEffort = typeof value === "object" && Object.hasOwn(value, "reasoningEffort");
  const row = object(value, ["providerId", "modelId", ...(hasEffort ? ["reasoningEffort"] : []), ...(typeof value === "object" && Object.hasOwn(value, "serviceTier") ? ["serviceTier"] : [])]);
  return { providerId: modelName(row.providerId), modelId: modelName(row.modelId),
    reasoningEffort: row.reasoningEffort === undefined ? null : nullableName(row.reasoningEffort),
    ...decodeServiceTier(row, row.providerId) };
}

/** Validate frozen text evidence without assigning disclosure or tool authority. */
export function decodeAgentContextText(value: unknown): AgentContextText {
  const source = object(value, ["sourceId", "kind", "resourceId", "revision", "anchor", "text"]);
  if (typeof source.text !== "string" || utf8Bytes(source.text) > 8_388_608) return fail();
  if (source.kind !== "manuscript" && source.kind !== "paper" && source.kind !== "note" && source.kind !== "retrieval" && source.kind !== "userResource") return fail();
  return { sourceId: name(source.sourceId), kind: source.kind, resourceId: name(source.resourceId),
    revision: name(source.revision), anchor: sourceAnchor(source.anchor), text: source.text };
}

/** Decode one shared immutable input, independent of its host envelope. */
export function decodeAgentSubmissionInput(value: unknown): AgentSubmissionInput {
  const additionalKeys = ["userInput", "skillInstructions", "serviceTier", "remoteCompactionV2"].filter(key => !!value && typeof value === "object" && Object.hasOwn(value, key));
  const hasInstructions = !!value && typeof value === "object" && Object.hasOwn(value, "instructions");
  const hasSkills = !!value && typeof value === "object" && Object.hasOwn(value, "skills");
  const hasConfigs = !!value && typeof value === "object" && Object.hasOwn(value, "instructionConfigs");
  const input = object(value, ["text", "model", "reasoningEffort", "context", ...additionalKeys, ...(hasInstructions ? ["instructions"] : []), ...(hasConfigs ? ["instructionConfigs"] : []), ...(hasSkills ? ["skills"] : [])]);
  const instructionConfigs = hasConfigs ? decodeInstructionConfigs(input.instructionConfigs, fail) : undefined;
  const skills = hasSkills ? decodeSubmissionSkills(input.skills, fail) : undefined;
  const instructions = hasInstructions ? decodeInstructions(input.instructions) : undefined;
  const model = object(input.model, ["providerId", "modelId", "revision"]);
  if (additionalKeys.includes("remoteCompactionV2") && input.remoteCompactionV2 !== null
    && (typeof input.remoteCompactionV2 !== "boolean" || model.providerId !== "openai")) return fail();
  const text = decodeAgentSubmissionText(input.text);
  const userInput = decodeAgentUserInput(input.userInput, text);
  const skillInstructions = decodeAgentSkillInstructions(input.skillInstructions);
  // Unresolved reference tags are display metadata, not executable skills.
  const prompts = new Set<string>();
  for (const prompt of skillInstructions) {
    const key = JSON.stringify([prompt.identity.environment_id, prompt.identity.source_id]);
    if (prompts.has(key) || !skills?.some(skill => skill.explicit && skill.descriptor.name === prompt.name && sameAgentSkillIdentity(skill.descriptor.identity, prompt.identity))) return fail();
    prompts.add(key);
  }
  if (!Array.isArray(input.context) || input.context.length > 256) return fail();
  let bytes = utf8Bytes(text) + skillInstructions.reduce((sum, prompt) => sum + utf8Bytes(prompt.contents), 0) + (skills ? utf8Bytes(JSON.stringify(skills)) : 0) + (instructionConfigs ? utf8Bytes(JSON.stringify(instructionConfigs)) : 0) + (instructions?.reduce((sum, entry) => sum + utf8Bytes(entry.text), 0) ?? 0);
  if (bytes > 8_388_608) return fail();
  const ids = new Set<string>();
  const context = input.context.map((value): AgentContextText => {
    const source = decodeAgentContextText(value);
    if (ids.has(source.sourceId)) return fail();
    ids.add(source.sourceId);
    bytes += utf8Bytes(source.text) + (source.anchor === null ? 0 : utf8Bytes(source.anchor));
    if (bytes > 8_388_608) return fail();
    return source;
  });
  return { ...decodeServiceTier(input, model.providerId), ...(additionalKeys.includes("remoteCompactionV2") ? {remoteCompactionV2: input.remoteCompactionV2 as boolean | null} : {}), ...(additionalKeys.includes("userInput") ? {userInput} : {}), ...(additionalKeys.includes("skillInstructions") ? {skillInstructions} : {}), text, model: { providerId: modelName(model.providerId), modelId: modelName(model.modelId), revision: model.revision === null ? null : modelName(model.revision) }, reasoningEffort: nullableName(input.reasoningEffort), context, ...(instructions ? { instructions } : {}), ...(instructionConfigs ? { instructionConfigs } : {}), ...(skills ? { skills } : {}) };
}
/** Decode the writing envelope while preserving the shared input contract. */
export function decodeAgentSubmissionPreview(value: unknown): AgentSubmissionPreview {
  const row = object(value, ["schemaVersion", "conversationId", "requestId", "manuscriptId", "turnId", "contextSnapshotId", "input"]);
  if (row.schemaVersion !== 1) return fail();
  return { schemaVersion: 1, conversationId: uuid(row.conversationId), requestId: uuid(row.requestId), manuscriptId: uuid(row.manuscriptId),
    turnId: uuid(row.turnId), contextSnapshotId: uuid(row.contextSnapshotId), input: decodeAgentSubmissionInput(row.input) };
}

export interface AgentWritingStartRequest extends AgentWritingReceipt {
  readonly contextSnapshotId: string;
  readonly model: AgentModelIdentity;
  readonly mode: AgentExecutionMode;
}
export interface AgentWritingQueuedStartRequest {
  readonly inputId: string;
  readonly expectedRevision: number;
  readonly start: AgentWritingStartRequest;
}

export interface AgentWritingSteerRequest {
  readonly conversationId: string;
  readonly manuscriptId: string;
  readonly turnId: string;
  readonly inputId: string;
  readonly text: string;
  readonly userInput?: readonly AgentUserInput[];
}
export interface AgentWritingRecoveryRequest {
  readonly conversationId: string;
  readonly manuscriptId: string;
  readonly turnId: string;
}

export interface AgentWritingQueueScope {
  readonly conversationId: string;
  readonly manuscriptId: string;
}
export interface AgentWritingQueuePreviewRequest {
  readonly inputId: string;
  readonly expectedRevision: number;
  readonly submission: AgentWritingPrepareRequest;
}
export interface AgentWritingQueueCancelRequest extends AgentWritingQueueScope {
  readonly requestId: string;
  readonly expectedRevision: number;
  readonly inputId: string;
  readonly previewRequestId: string;
}
export interface AgentWritingQueuePreviewResponse {
  readonly schemaVersion: 1;
  readonly inputId: string;
  readonly preview: AgentSubmissionPreview;
  readonly queue: AgentWritingQueueResponse;
}
export function decodeAgentWritingQueuePreview(value: unknown): AgentWritingQueuePreviewResponse {
  const row = object(value, ["schemaVersion", "inputId", "preview", "queue"]);
  if (row.schemaVersion !== 1) return fail();
  const inputId = queueUuid(row.inputId);
  const preview = decodeAgentSubmissionPreview(row.preview);
  const queue = decodeAgentWritingQueueResponse(row.queue);
  if (queue.preparingInputId !== inputId || preview.conversationId !== queue.conversationId
    || preview.manuscriptId !== queue.manuscriptId || preview.input.text !== queue.inputs.find(input => input.inputId === inputId)?.text) return fail();
  return { schemaVersion: 1, inputId, preview, queue };
}
export type AgentQueueEdit =
  | { readonly type: "add" | "update"; readonly inputId: string; readonly text: string; readonly userInput?: readonly AgentUserInput[] }
  | { readonly type: "restore"; readonly inputId: string; readonly sourceInputId: string; readonly index: number; readonly text: string; readonly userInput?: readonly AgentUserInput[] }
  | { readonly type: "remove" | "pauseInput" | "resumeInput"; readonly inputId: string }
  | { readonly type: "reorder"; readonly inputIds: readonly string[] }
  | { readonly type: "pause" | "resume" };
export interface AgentQueueCommand {
  readonly requestId: string;
  readonly expectedRevision: number;
  readonly edit: AgentQueueEdit;
}
export interface AgentWritingQueueEditRequest extends AgentWritingQueueScope, AgentQueueCommand {readonly expectedEpoch?: string}
export interface AgentWritingQueueResponse extends AgentWritingQueueScope, AgentQueueState {}
export interface AgentQueueState {
  readonly conversationId: string;
  readonly schemaVersion: 1;
  readonly revision: number;
  readonly paused: boolean;
  readonly preparingInputId: string | null;
  readonly inputs: readonly { readonly inputId: string; readonly text: string; readonly paused?: boolean; readonly userInput?: readonly AgentUserInput[]; readonly origin?: AgentConversationBinding }[];
}

function queueUuid(value: unknown): string {
  const id = uuid(value);
  return id === "00000000-0000-0000-0000-000000000000" ? fail() : id;
}
/** Text accepted by bounded persistent input queues, including same-turn steering. */
export function decodeAgentQueuedText(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || utf8Bytes(value) > 65536) return fail();
  return value;
}
export function decodeAgentWritingQueueScope(value: unknown): AgentWritingQueueScope {
  const row = object(value, ["conversationId", "manuscriptId"]);
  return { conversationId: queueUuid(row.conversationId), manuscriptId: queueUuid(row.manuscriptId) };
}
export function decodeAgentWritingQueueEditRequest(value: unknown): AgentWritingQueueEditRequest {
  const guarded = !!value && typeof value === "object" && Object.hasOwn(value, "expectedEpoch");
  const row = object(value, ["conversationId", "manuscriptId", "requestId", "expectedRevision", "edit", ...(guarded ? ["expectedEpoch"] : [])]);
  return { ...decodeAgentWritingQueueScope({conversationId:row.conversationId,manuscriptId:row.manuscriptId}),
    ...decodeAgentQueueCommand({requestId:row.requestId,expectedRevision:row.expectedRevision,edit:row.edit}), ...(guarded ? {expectedEpoch: queueUuid(row.expectedEpoch)} : {}) };
}
export function decodeAgentQueueCommand(value: unknown): AgentQueueCommand {
  const row = object(value,["requestId","expectedRevision","edit"]);
  if (!Number.isSafeInteger(row.expectedRevision) || typeof row.expectedRevision !== "number"
    || row.expectedRevision < 0 || row.expectedRevision >= Number.MAX_SAFE_INTEGER) return fail();
  if (!row.edit || typeof row.edit !== "object" || !("type" in row.edit)) return fail();
  const type = row.edit.type;
  let edit: AgentQueueEdit;
  if (type === "restore") {
    const hasInput = Object.hasOwn(row.edit, "userInput");
    const item = object(row.edit, ["type", "inputId", "sourceInputId", "index", "text", ...(hasInput ? ["userInput"] : [])]);
    if (typeof item.index !== "number" || !Number.isSafeInteger(item.index) || item.index < 0 || item.index > 64) return fail();
    edit = {type, inputId: queueUuid(item.inputId), sourceInputId: queueUuid(item.sourceInputId), index: item.index,
      text: decodeAgentQueuedText(item.text), ...(hasInput ? {userInput: decodeAgentUserInput(item.userInput, decodeAgentQueuedText(item.text))} : {})};
  } else if (type === "add" || type === "update") {
    const hasInput = Object.hasOwn(row.edit, "userInput");
    const item = object(row.edit, ["type", "inputId", "text", ...(hasInput ? ["userInput"] : [])]);
    edit = { type, inputId: queueUuid(item.inputId), text: decodeAgentQueuedText(item.text), ...(hasInput ? {userInput: decodeAgentUserInput(item.userInput, decodeAgentQueuedText(item.text))} : {}) };
  } else if (type === "remove" || type === "pauseInput" || type === "resumeInput") {
    const item = object(row.edit, ["type", "inputId"]);
    edit = { type, inputId: queueUuid(item.inputId) };
  } else if (type === "reorder") {
    const item = object(row.edit, ["type", "inputIds"]);
    if (!Array.isArray(item.inputIds) || item.inputIds.length > 64) return fail();
    const inputIds = item.inputIds.map(queueUuid);
    if (new Set(inputIds).size !== inputIds.length) return fail();
    edit = { type, inputIds };
  } else if (type === "pause" || type === "resume") {
    object(row.edit, ["type"]);
    edit = { type };
  } else return fail();
  return { requestId: queueUuid(row.requestId), expectedRevision: row.expectedRevision, edit };
}
export function decodeAgentWritingQueueResponse(value: unknown): AgentWritingQueueResponse {
  const row = object(value, ["schemaVersion", "conversationId", "manuscriptId", "revision", "paused", "preparingInputId", "inputs"]);
  const {manuscriptId,...state}=row;
  return {...decodeAgentQueueState(state),manuscriptId:queueUuid(manuscriptId)};
}
export function decodeAgentQueueState(value: unknown): AgentQueueState {
  const row = object(value,["schemaVersion","conversationId","revision","paused","preparingInputId","inputs"]);
  if (row.schemaVersion !== 1 || typeof row.revision !== "number" || !Number.isSafeInteger(row.revision)
    || row.revision < 0 || typeof row.paused !== "boolean" || !Array.isArray(row.inputs) || row.inputs.length > 64) return fail();
  const ids = new Set<string>();
  const inputs = row.inputs.map((value) => {
    const hasOrigin = !!value && typeof value === "object" && Object.hasOwn(value, "origin");
    const hasInput = !!value && typeof value === "object" && Object.hasOwn(value, "userInput");
    const hasPaused = !!value && typeof value === "object" && Object.hasOwn(value, "paused");
    const item = object(value, ["inputId", "text", ...(hasPaused ? ["paused"] : []), ...(hasOrigin ? ["origin"] : []), ...(hasInput ? ["userInput"] : [])]);
    const inputId = queueUuid(item.inputId);
    if (ids.has(inputId)) return fail();
    ids.add(inputId);
    let origin: AgentConversationBinding | undefined;
    if(hasOrigin){
      const source = object(item.origin, ["kind", "resourceId"]);
      if(source.kind !== "manuscript" && source.kind !== "paper" && source.kind !== "note" && source.kind !== "readingNote")return fail();
      if (source.kind === "paper" && !isAgentPaperQueueId(source.resourceId)) return fail();
      origin={kind:source.kind,resourceId:source.kind === "paper" ? source.resourceId as string : queueUuid(source.resourceId)};
    }
    if (hasPaused && typeof item.paused !== "boolean") return fail();
    return { inputId, ...(hasPaused ? {paused: item.paused as boolean} : {}), text: decodeAgentQueuedText(item.text), ...(hasInput ? {userInput: decodeAgentUserInput(item.userInput, decodeAgentQueuedText(item.text))} : {}), ...(origin?{origin}:{}) };
  });
  const preparingInputId = row.preparingInputId === null ? null : queueUuid(row.preparingInputId);
  if (preparingInputId !== null && preparingInputId !== inputs.find(input => !input.paused)?.inputId) return fail();
  return { schemaVersion: 1, conversationId: queueUuid(row.conversationId),
    revision: row.revision, paused: row.paused, preparingInputId, inputs };
}
export interface AgentWritingRecoveryResponse extends AgentWritingRecoveryRequest {
  readonly schemaVersion: 1;
  readonly inputs: readonly { readonly inputId: string; readonly text: string;readonly userInput?:readonly AgentUserInput[] }[];
}
export function decodeAgentWritingRecoveryResponse(value: unknown): AgentWritingRecoveryResponse {
  const row = object(value, ["schemaVersion", "conversationId", "manuscriptId", "turnId", "inputs"]);
  if (row.schemaVersion !== 1 || !Array.isArray(row.inputs) || row.inputs.length > 64) return fail();
  const ids = new Set<string>();
  const inputs = row.inputs.map((value) => {
    const input = object(value, ["inputId", "text",...((value as {userInput?:unknown}).userInput!==undefined?["userInput"]:[])]);
    const inputId = uuid(input.inputId);
    if (ids.has(inputId) || typeof input.text !== "string" || !input.text.trim() || utf8Bytes(input.text) > 65536) return fail();
    ids.add(inputId);
    return { inputId, text: input.text,...(input.userInput!==undefined?{userInput:decodeAgentUserInput(input.userInput,input.text)}:{}) };
  });
  return { schemaVersion: 1, conversationId: uuid(row.conversationId), manuscriptId: uuid(row.manuscriptId), turnId: uuid(row.turnId), inputs };
}
/** Durable admission only; consumption is reported through the conversation history. */
export interface AgentSteerResponse {
  readonly schemaVersion: 1;
  readonly conversationId: string;
  readonly turnId: string;
  readonly inputId: string;
}
export type AgentWritingSteerResponse = AgentSteerResponse;
export const decodeAgentWritingSteerResponse = decodeAgentSteerResponse;
export function decodeAgentSteerResponse(value: unknown): AgentSteerResponse {
  const row = object(value, ["schemaVersion", "conversationId", "turnId", "inputId"]);
  if (row.schemaVersion !== 1) return fail();
  return { schemaVersion: 1, conversationId: uuid(row.conversationId), turnId: uuid(row.turnId), inputId: uuid(row.inputId) };
}
export interface AgentStartResponse {
  readonly schemaVersion: 1;
  readonly conversationId: string;
  readonly requestId: string;
  readonly turnId: string;
  /** Process-local task identity, present when the original owner is known. */
  readonly runId?: string;
  readonly alreadyStarted: boolean;
  readonly outcome: "completed" | "failed" | "canceled" | "interrupted" | null;
}
export function decodeAgentStartResponse(value: unknown): AgentStartResponse {
  const hasRunId = typeof value === "object" && value !== null && Object.hasOwn(value, "runId");
  const row = object(value, ["schemaVersion", "conversationId", "requestId", "turnId", "alreadyStarted", "outcome", ...(hasRunId ? ["runId"] : [])]);
  if (row.schemaVersion !== 1 || typeof row.alreadyStarted !== "boolean") return fail();
  if (row.outcome !== null && row.outcome !== "completed" && row.outcome !== "failed" && row.outcome !== "canceled" && row.outcome !== "interrupted") return fail();
  if (!row.alreadyStarted && row.outcome !== null) return fail();
  const runId = hasRunId ? uuid(row.runId) : undefined;
  if (runId === "00000000-0000-0000-0000-000000000000") return fail();
  return { schemaVersion: 1, conversationId: uuid(row.conversationId), requestId: uuid(row.requestId), turnId: uuid(row.turnId), alreadyStarted: row.alreadyStarted, outcome: row.outcome, ...(runId === undefined ? {} : {runId}) };
}

function decodeInstructions(value: unknown): readonly AgentInstructionFragment[] {
  if (!Array.isArray(value) || value.length > 256) return fail();
  const identities = new Set<string>();
  let bytes = 0;
  return value.map((entry): AgentInstructionFragment => {
    const row = object(entry, ["environmentId", "scopeId", "sourceId", "revision", "originalBytes", "text", "disposition"]);
    const environmentId = name(row.environmentId), scopeId = name(row.scopeId), sourceId = name(row.sourceId), revision = name(row.revision);
    const identity = JSON.stringify([environmentId, scopeId, sourceId]);
    if (identities.has(identity) || typeof row.text !== "string" || typeof row.originalBytes !== "number" || !Number.isSafeInteger(row.originalBytes) || row.originalBytes < 0) return fail();
    identities.add(identity);
    const size = utf8Bytes(row.text);
    bytes += size;
    if (bytes > 1_048_576) return fail();
    const disposition = row.disposition;
    if (disposition === "included") { if (row.originalBytes !== size || !row.text.trim()) return fail(); }
    else if (disposition === "truncated") { if (row.originalBytes <= size) return fail(); }
    else if (disposition === "empty" || disposition === "budgetExcluded") { if (row.text !== "") return fail(); }
    else return fail();
    return { environmentId, scopeId, sourceId, revision, originalBytes: row.originalBytes, text: row.text, disposition };
  });
}

export type AgentWritingStartResponse = AgentStartResponse;
export { decodeAgentStartResponse as decodeAgentWritingStartResponse };
