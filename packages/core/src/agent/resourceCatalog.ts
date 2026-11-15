import { row } from "./workspaceDecoding";
import { decodeAgentReferenceInput, type AgentReferenceInput } from "./userInput";
export interface AgentResourceScope { readonly conversationId: string; readonly kind: "manuscript" | "paper" | "note" | "readingNote"; readonly resourceId: string }
export interface AgentPickerResource { readonly group: "tools" | "skills" | "files"; readonly label: string; readonly source: string; readonly input: AgentReferenceInput; readonly disabled?: boolean }
export function decodeAgentHostResources(value: unknown): readonly AgentPickerResource[] {
  if (!Array.isArray(value) || value.length > 512) throw new Error("Invalid agent resources");
  return value.map(value => {
    const item = row(value, ["group", "label", "source", "input"]);
    if (!(["tools", "skills", "files"] as unknown[]).includes(item.group) || typeof item.label !== "string" || !item.label.trim() || typeof item.source !== "string" || item.source.length > 1024) throw new Error("Invalid agent resource");
    return {group: item.group as AgentPickerResource["group"], label: item.label, source: item.source, input: decodeAgentReferenceInput(item.input)};
  });
}
