import {parseSourceLink, formatSourceLink} from "../sourceNavigation";
/** Adapted from Codex protocol/user_input and TUI mention bindings at
 * e363b08c9175ac1cbe5893615dd2cb9ddf95043b (Apache-2.0).
 * Native adapters resolve opaque identities instead of renderer paths. */
import { row, utf8Length } from "./workspaceDecoding";
import { decodeAgentEvidenceInput, type AgentEvidenceInput } from "./evidenceInput";
export interface AgentSkillIdentity { readonly environment_id: string; readonly source_id: string; readonly revision: string }
export type AgentMentionTarget =
  | { readonly kind: "tool"; readonly serverId: string; readonly environmentId: string; readonly revision: string }
  | { readonly kind: "file"; readonly sourceId: string; readonly resourceId: string; /** Canonical display/navigation address; native admission resolves it again. */ readonly sourceUrl?: string; /** Legacy metadata, never a file version binding. */ readonly revision?: string };
export type AgentReferenceInput =
  | { readonly type: "skill"; readonly name: string; readonly identity: AgentSkillIdentity }
  | { readonly type: "mention"; readonly name: string; readonly target: AgentMentionTarget };
export interface AgentTextElement { readonly startUtf16: number; readonly endUtf16: number; readonly itemIndex: number }
export type AgentUserInput = { readonly type: "text"; readonly text: string; readonly textElements: readonly AgentTextElement[] } | AgentReferenceInput | AgentEvidenceInput;
export interface AgentSkillInstructions { readonly identity: AgentSkillIdentity; readonly name: string; readonly contents: string }
export interface AgentMentionBinding { readonly startUtf16: number; readonly endUtf16: number; readonly input: AgentReferenceInput }
export interface AgentInputDraft { readonly text: string; readonly bindings: readonly AgentMentionBinding[]; readonly unboundReferences?: readonly AgentReferenceInput[]; readonly evidence?: readonly AgentEvidenceInput[] }
function sourceUrl(value: unknown): string {
  if (typeof value !== "string") throw new Error("Invalid source address");
  const link = parseSourceLink(value);
  if (link.locator) throw new Error("File identity must not include a locator");
  return formatSourceLink(link);
}
function safe(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || utf8Length(value) > 1024 || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) throw new Error("Invalid agent input identity");
  return value;
}
export function decodeAgentSkillIdentity(value: unknown): AgentSkillIdentity {
  const identity = row(value, ["environment_id", "source_id", "revision"]);
  return { environment_id: safe(identity.environment_id), source_id: safe(identity.source_id), revision: safe(identity.revision) };
}
export function sameAgentSkillIdentity(a: AgentSkillIdentity, b: AgentSkillIdentity): boolean {
  return a.environment_id === b.environment_id && a.source_id === b.source_id && a.revision === b.revision;
}
export function decodeAgentReferenceInput(value: unknown): AgentReferenceInput {
  if (!value || typeof value !== "object") throw new Error("Invalid agent reference");
  if ((value as {type?: unknown}).type === "skill") {
    const item = row(value, ["type", "name", "identity"]);
    return { type: "skill", name: safe(item.name), identity: decodeAgentSkillIdentity(item.identity) };
  }
  const item = row(value, ["type", "name", "target"]);
  if (item.type !== "mention" || !item.target || typeof item.target !== "object") throw new Error("Invalid mention");
  const kind = (item.target as {kind?: unknown}).kind;
  if (kind === "tool") {
    const target = row(item.target, ["kind", "serverId", "environmentId", "revision"]);
    return {type: "mention", name: safe(item.name), target: {kind, serverId: safe(target.serverId), environmentId: safe(target.environmentId), revision: safe(target.revision)}};
  }
  const target = row(item.target, ["kind", "sourceId", "resourceId", ...(Object.hasOwn(item.target, "revision") ? ["revision"] : []), ...(Object.hasOwn(item.target, "sourceUrl") ? ["sourceUrl"] : [])]);
  if (target.kind !== "file") throw new Error("Invalid mention kind");
  return {type: "mention", name: safe(item.name), target: {kind: "file", sourceId: safe(target.sourceId), resourceId: safe(target.resourceId), ...(target.sourceUrl === undefined ? {} : {sourceUrl: sourceUrl(target.sourceUrl)}), ...(target.revision === undefined ? {} : {revision: safe(target.revision)})}};
}
function splitsSurrogate(text:string,index:number):boolean {return index>0 && index<text.length && /[\uD800-\uDBFF]/u.test(text[index-1]!) && /[\uDC00-\uDFFF]/u.test(text[index]!);}
export function decodeAgentUserInput(value: unknown, text: string): readonly AgentUserInput[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 257 || utf8Length(JSON.stringify(value)) > 2_097_152) throw new Error("Invalid agent input");
  if (!value.length) return [];
  const first = row(value[0], ["type", "text", "textElements"]);
  if (first.type !== "text" || first.text !== text || !Array.isArray(first.textElements) || first.textElements.length > 256) throw new Error("Input text mismatch");
  let previousEnd = 0;
  const textElements = first.textElements.map((valueElement): AgentTextElement => {
    const element = row(valueElement, ["startUtf16", "endUtf16", "itemIndex"]);
    const {startUtf16, endUtf16, itemIndex} = element;
    if (typeof startUtf16 !== "number" || typeof endUtf16 !== "number" || typeof itemIndex !== "number"
      || ![startUtf16,endUtf16,itemIndex].every(Number.isSafeInteger) || startUtf16 < previousEnd || endUtf16 <= startUtf16 || endUtf16 > text.length || itemIndex < 1 || itemIndex >= value.length || splitsSurrogate(text,startUtf16) || splitsSurrogate(text,endUtf16)) throw new Error("Invalid input binding");
    previousEnd = endUtf16;
    return {startUtf16, endUtf16, itemIndex};
  });
  const items = value.slice(1).map(item => item?.type === "selection" || item?.type === "annotation" ? decodeAgentEvidenceInput(item) : decodeAgentReferenceInput(item));
  if (textElements.some(element => !["skill", "mention"].includes(items[element.itemIndex - 1]!.type))) throw new Error("Evidence cannot be an inline mention");
  return [{type: "text", text, textElements}, ...items];
}
export function decodeAgentSkillInstructions(value: unknown): readonly AgentSkillInstructions[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 256) throw new Error("Invalid skill instructions");
  let bytes = 0;
  return value.map(value => {
    const prompt = row(value, ["identity", "name", "contents"]);
    if (typeof prompt.contents !== "string" || !prompt.contents.trim() || prompt.contents.includes("\0")) throw new Error("Invalid skill contents");
    bytes += utf8Length(prompt.contents);
    if (bytes > 1_048_576) throw new Error("Skill budget exceeded");
    return {identity: decodeAgentSkillIdentity(prompt.identity), name: safe(prompt.name), contents: prompt.contents};
  });
}
export function agentDraftInput(draft: AgentInputDraft): readonly AgentUserInput[] {
  if (!draft.bindings.length && !draft.unboundReferences?.length && !draft.evidence?.length) return [];
  return [{type: "text", text: draft.text, textElements: draft.bindings.map((binding, index) => ({startUtf16: binding.startUtf16, endUtf16: binding.endUtf16, itemIndex: index + 1}))}, ...draft.bindings.map(binding => binding.input), ...(draft.unboundReferences ?? []), ...(draft.evidence ?? [])];
}
export function agentDraftFromInput(text: string, value: readonly AgentUserInput[] = []): AgentInputDraft {
  const items = decodeAgentUserInput(value, text), first = items[0];
  const unboundReferences = items.slice(1).filter((item, index) => (item.type === "skill" || item.type === "mention") && first?.type === "text" && !first.textElements.some(element => element.itemIndex === index + 1)) as readonly AgentReferenceInput[];
  const evidence = items.filter((item): item is AgentEvidenceInput => item.type === "annotation");
  return {text, bindings: first?.type === "text" ? first.textElements.map(element => ({startUtf16: element.startUtf16, endUtf16: element.endUtf16, input: items[element.itemIndex] as AgentReferenceInput})) : [], ...(unboundReferences.length ? {unboundReferences} : {}), ...(evidence.length ? {evidence} : {})};
}
export function trimmedAgentDraftInput(draft: AgentInputDraft): readonly AgentUserInput[] {
  const offset = draft.text.length - draft.text.trimStart().length, text = draft.text.trim();
  return agentDraftInput({...draft, text, bindings: draft.bindings.filter(binding => binding.startUtf16 >= offset && binding.endUtf16 <= offset + text.length).map(binding => ({...binding, startUtf16: binding.startUtf16 - offset, endUtf16: binding.endUtf16 - offset}))});
}
/** Preserve bindings outside an edit; editing a reference removes its identity. */
export function editAgentDraft(draft: AgentInputDraft, text: string): AgentInputDraft {
  if (text === draft.text) return draft;
  let prefix = 0;
  while (prefix < text.length && prefix < draft.text.length && text[prefix] === draft.text[prefix]) prefix++;
  let oldEnd = draft.text.length, newEnd = text.length;
  while (oldEnd > prefix && newEnd > prefix && draft.text[oldEnd - 1] === text[newEnd - 1]) { oldEnd--; newEnd--; }
  const delta = newEnd - oldEnd;
  const bindings = draft.bindings.flatMap(binding => {
    if (binding.endUtf16 <= prefix) return [binding];
    if (binding.startUtf16 >= oldEnd) return [{...binding, startUtf16: binding.startUtf16 + delta, endUtf16: binding.endUtf16 + delta}];
    return [];
  });
  return {...draft, text, bindings};
}
export function insertAgentReference(draft: AgentInputDraft, input: AgentReferenceInput, start = draft.text.length, end = start): AgentInputDraft {
  const token = `@${input.name}`, before = draft.text.slice(0, start), after = draft.text.slice(end);
  const separator = before && !/\s$/u.test(before) ? " " : "";
  const edited = editAgentDraft(draft, before + separator + token + " " + after);
  const offset = start + separator.length;
  return {...edited, bindings: [...edited.bindings, {startUtf16: offset, endUtf16: offset + token.length, input}].sort((a,b) => a.startUtf16-b.startUtf16)};
}
