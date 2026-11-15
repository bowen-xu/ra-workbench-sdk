import { AgentCatalogDecodeError } from "./catalog";

function fail(): never { throw new AgentCatalogDecodeError(); }
/** Native UUID serde forms identify the same operation, irrespective of spelling. */
export function catalogOperationId(value: unknown): string {
  if (typeof value !== "string") return fail();
  let text = value;
  if (text.startsWith("urn:uuid:")) text = text.slice(9);
  else if (text.startsWith("{") && text.endsWith("}")) text = text.slice(1, -1);
  if (/^[\da-f]{32}$/iu.test(text)) text = `${text.slice(0, 8)}-${text.slice(8, 12)}-${text.slice(12, 16)}-${text.slice(16, 20)}-${text.slice(20)}`;
  if (!/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/iu.test(text)
    || text === "00000000-0000-0000-0000-000000000000") return fail();
  return text.toLowerCase();
}
export function agentSqlFence(value: unknown): string {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]{0,19})$/u.test(value)
    || (value.length === 20 && value > "18446744073709551615")) return fail();
  return value;
}
export function catalogOperationBoolean(value: unknown): boolean {
  return typeof value === "boolean" ? value : fail();
}
export function catalogOperationReason(value: unknown): string {
  return typeof value === "string" && /^[a-zA-Z][a-zA-Z0-9_-]{0,100}$/u.test(value) ? value : fail();
}
