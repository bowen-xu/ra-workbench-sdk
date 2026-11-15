/** Versioned metadata IPC; independent of provider thread history. */
export interface AgentCatalogCursor { readonly createdAt: string; readonly id: string }
export interface AgentConversationSummary {
  readonly internal?: boolean;
  readonly id: string;
  readonly title: string;
  readonly archived: boolean;
  readonly durableCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}
export interface AgentCatalogPage {
  readonly schemaVersion: 1;
  readonly conversations: readonly AgentConversationSummary[];
  readonly next: AgentCatalogCursor | null;
}
/** Read-only lifecycle metadata, independent of list filters and pagination. */
export interface AgentConversationActivity { readonly id: string; readonly internal: boolean }
export function decodeAgentConversationActivity(value: unknown): readonly AgentConversationActivity[] {
  const response = object(value, ["schemaVersion", "running"]);
  if (response.schemaVersion !== 1 || !Array.isArray(response.running)) throw new AgentCatalogDecodeError();
  const running = response.running.map(value => {
    const row = object(value, ["id", "internal"]);
    if (typeof row.internal !== "boolean") throw new AgentCatalogDecodeError();
    return {id: id(row.id), internal: row.internal};
  });
  if (new Set(running.map(row => row.id)).size !== running.length) throw new AgentCatalogDecodeError();
  return running;
}
export interface AgentRenameResponse { readonly schemaVersion: 1; readonly conversation: AgentConversationSummary }
export interface AgentConversationBinding { readonly kind: "manuscript" | "paper" | "note" | "readingNote"; readonly resourceId: string }
export interface AgentMetadataRequest { readonly id: string; readonly binding?: AgentConversationBinding }
export interface AgentCatalogRequest { readonly internal?: boolean; readonly archived: boolean; readonly limit: number; readonly before: AgentCatalogCursor | null; readonly binding?: AgentConversationBinding | null }
export interface AgentRenameRequest { readonly operationId: string; readonly id: string; readonly expectedTitle: string; readonly title: string }
export interface AgentArchiveRequest {
  readonly operationId: string;
  readonly id: string;
  readonly archived: boolean;
  /** The caller's original history decision. Restore does not inspect history. */
  readonly expectedWatermark: number | null;
}
export type AgentCatalogCommandError = "invalidInput" | "notFound" | "conflict" | "busy" | "tooLarge" | "unavailable" | "corrupt";

export class AgentCatalogDecodeError extends Error {
  constructor() { super("Invalid or unsupported agent catalog response"); this.name = "AgentCatalogDecodeError"; }
}
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some((key) => !keys.includes(key))) throw new AgentCatalogDecodeError();
  return value as Record<string, unknown>;
}
function id(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)) throw new AgentCatalogDecodeError();
  return value.toLowerCase();
}
function timestamp(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) throw new AgentCatalogDecodeError();
  return value;
}
function summary(value: unknown): AgentConversationSummary {
  const row = object(value, ["id", "title", "archived", "durableCount", "createdAt", "updatedAt", "internal"]);
  if (row.internal !== undefined && typeof row.internal !== "boolean") throw new AgentCatalogDecodeError();
  if (typeof row.title !== "string" || !row.title.trim() || [...row.title].length > 180 || row.title.includes("\0")
    || typeof row.archived !== "boolean" || typeof row.durableCount !== "number"
    || !Number.isSafeInteger(row.durableCount) || row.durableCount < 0) throw new AgentCatalogDecodeError();
  return { ...(row.internal ? { internal: true } : {}), id: id(row.id), title: row.title, archived: row.archived, durableCount: row.durableCount,
    createdAt: timestamp(row.createdAt), updatedAt: timestamp(row.updatedAt) };
}
export function decodeAgentCatalogPage(value: unknown): AgentCatalogPage {
  const page = object(value, ["schemaVersion", "conversations", "next"]);
  if (page.schemaVersion !== 1 || !Array.isArray(page.conversations) || page.conversations.length > 500) throw new AgentCatalogDecodeError();
  const conversations = page.conversations.map(summary);
  if (new Set(conversations.map((entry) => entry.id)).size !== conversations.length) throw new AgentCatalogDecodeError();
  let next: AgentCatalogCursor | null = null;
  if (page.next !== null) {
    const cursor = object(page.next, ["createdAt", "id"]);
    next = { createdAt: timestamp(cursor.createdAt), id: id(cursor.id) };
    const last = conversations.at(-1);
    if (!last || next.id !== last.id || next.createdAt !== last.createdAt) throw new AgentCatalogDecodeError();
  }
  return { schemaVersion: 1, conversations, next };
}
export function decodeAgentRenameResponse(value: unknown): AgentRenameResponse {
  const response = object(value, ["schemaVersion", "conversation"]);
  if (response.schemaVersion !== 1) throw new AgentCatalogDecodeError();
  return { schemaVersion: 1, conversation: summary(response.conversation) };
}
