// Shared strict primitives for catalog identity, host scope and versioned commands.
import { AgentCatalogDecodeError, type AgentConversationBinding } from "./catalog";

export function catalogObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !keys.includes(key))) throw new AgentCatalogDecodeError();
  return value as Record<string, unknown>;
}
export function catalogId(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(value)
    || value === "00000000-0000-0000-0000-000000000000") throw new AgentCatalogDecodeError();
  return value.toLowerCase();
}
export function catalogBinding(value: unknown): AgentConversationBinding {
  const binding = catalogObject(value, ["kind", "resourceId"]);
  if ((binding.kind !== "manuscript" && binding.kind !== "paper" && binding.kind !== "note" && binding.kind !== "readingNote")
    || typeof binding.resourceId !== "string" || !binding.resourceId.trim() || [...binding.resourceId].length > 256 || binding.resourceId.includes("\0")) throw new AgentCatalogDecodeError();
  return { kind: binding.kind, resourceId: binding.resourceId };
}
