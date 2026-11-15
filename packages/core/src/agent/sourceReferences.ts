import {systemDocumentPath} from "./systemDocuments";
import { formatSourceLink, parseSourceLink } from "../sourceNavigation";
import { decodeAgentContextResource } from "./contextSelection";
import type { AgentResourceScope } from "./resourceCatalog";
import { agentDraftFromInput, agentDraftInput, trimmedAgentDraftInput, type AgentInputDraft, type AgentReferenceInput } from "./userInput";

export function agentFileSourceLink(input: AgentReferenceInput, scope?: AgentResourceScope): string | undefined {
  if (input.type !== "mention" || input.target.kind !== "file") return undefined;
  const target = input.target;
  if (target.sourceUrl) { try {return formatSourceLink(parseSourceLink(target.sourceUrl));} catch {return undefined;} }
  if (target.sourceId.startsWith("source://")) { try { return formatSourceLink(parseSourceLink(target.sourceId)); } catch { return undefined; } }
  if (target.sourceId === `builtin:${target.resourceId}`) return systemDocumentPath(target.resourceId);
  if (target.sourceId.startsWith("context:")) {
    const resource = decodeAgentContextResource(JSON.parse(target.sourceId.slice(8)));
    if (resource.kind === "structuredObject") return undefined;
    if (resource.kind === "templateCatalog") return "source://agents/skills/edit-structured-resources/assets/reading";
    const path = resource.kind === "paper" && resource.attachmentId ? ["library", resource.resourceId, resource.attachmentId]
      : resource.kind === "manuscriptFile" ? ["writings", resource.resourceId, ...resource.path.split("/")] : [resource.kind.startsWith("paper") ? "library" : resource.kind === "manuscript" ? "writings" : "notes", resource.resourceId];
    return formatSourceLink({ path });
  }
  if (scope?.kind === "manuscript") return formatSourceLink({ path: ["writings", scope.resourceId, ...target.resourceId.split("/")] });
  if (scope?.kind === "paper") return formatSourceLink({ path: scope.resourceId === target.resourceId ? ["library", scope.resourceId] : ["library", scope.resourceId, target.resourceId] });
  return scope ? formatSourceLink({ path: ["notes", target.resourceId] }) : undefined;
}
/** Composer chips keep their draft representation. Only the frozen wire text changes. */
export function serializeAgentSourceReferences(draft: AgentInputDraft, scope?: AgentResourceScope) {
  const text = draft.text.trim();
  const trimmed = agentDraftFromInput(text, trimmedAgentDraftInput(draft));
  let offset = 0, serialized = "";
  const bindings = trimmed.bindings.map(binding => {
    serialized += text.slice(offset, binding.startUtf16);
    const startUtf16 = serialized.length;
    const href = agentFileSourceLink(binding.input, scope);
    const label = binding.input.name.replace(/[\\[\]]/gu, value => `\\${value}`);
    serialized += href ? `[${label}](${href})` : text.slice(binding.startUtf16, binding.endUtf16);
    offset = binding.endUtf16;
    return { ...binding, startUtf16, endUtf16: serialized.length };
  });
  serialized += text.slice(offset);
  const submitted = { ...trimmed, text: serialized, bindings };
  return { text: serialized, userInput: agentDraftInput(submitted) };
}

/** Editing a queued input returns its bound wire links to composer tokens.
 * Literal Markdown outside a selected binding remains untouched. */
export function restoreAgentSourceDraft(draft: AgentInputDraft): AgentInputDraft {
  let offset = 0, text = "";
  const bindings = draft.bindings.map(binding => {
    text += draft.text.slice(offset, binding.startUtf16);
    const startUtf16 = text.length;
    const original = draft.text.slice(binding.startUtf16, binding.endUtf16);
    text += binding.input.type === "mention" && binding.input.target.kind === "file" && original.startsWith("[") && original.includes("](source://") ? `@${binding.input.name}` : original;
    offset = binding.endUtf16;
    return {...binding, startUtf16, endUtf16: text.length};
  });
  return {...draft, text: text + draft.text.slice(offset), bindings};
}
