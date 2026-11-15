import { AgentCatalogDecodeError, decodeAgentCatalogPage, type AgentCatalogRequest, type AgentCatalogCursor, type AgentConversationSummary } from "./catalog";

export interface AgentSearchRequest { readonly term: string; readonly scope: AgentCatalogRequest }
export interface AgentSearchHit {
  readonly conversation: AgentConversationSummary;
  readonly excerpt: string;
  readonly itemId: string | null;
  readonly turnId: string | null;
  readonly startSeq: number | null;
  readonly completed: boolean;
}
export interface AgentSearchPage {
  readonly schemaVersion: 1;
  readonly hits: readonly AgentSearchHit[];
  readonly next: AgentCatalogCursor | null;
}
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some((key) => !keys.includes(key))) throw new AgentCatalogDecodeError();
  return value as Record<string, unknown>;
}
function identity(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(value)
    || value === "00000000-0000-0000-0000-000000000000") throw new AgentCatalogDecodeError();
  return value.toLowerCase();
}
export function decodeAgentSearchPage(value: unknown): AgentSearchPage {
  const page = object(value, ["schemaVersion", "hits", "next"]);
  if (page.schemaVersion !== 1 || !Array.isArray(page.hits) || page.hits.length > 100) throw new AgentCatalogDecodeError();
  const rows = page.hits.map((hit) => object(hit, ["conversation", "excerpt", "itemId", "turnId", "startSeq", "completed"]));
  const metadata = decodeAgentCatalogPage({ schemaVersion: 1, conversations: rows.map((row) => row.conversation), next: page.next });
  const hits = rows.map((row, index): AgentSearchHit => {
    const conversation = metadata.conversations[index]!;
    if (typeof row.excerpt !== "string" || [...row.excerpt].length > 320 || typeof row.completed !== "boolean") throw new AgentCatalogDecodeError();
    if (row.itemId === null) {
      if (row.turnId !== null || row.startSeq !== null || !row.completed || row.excerpt !== conversation.title) throw new AgentCatalogDecodeError();
      return { conversation, excerpt: row.excerpt, itemId: null, turnId: null, startSeq: null, completed: true };
    }
    if (typeof row.startSeq !== "number" || !Number.isSafeInteger(row.startSeq) || row.startSeq < 1
      || row.startSeq > conversation.durableCount) throw new AgentCatalogDecodeError();
    return { conversation, excerpt: row.excerpt, itemId: identity(row.itemId), turnId: identity(row.turnId),
      startSeq: row.startSeq, completed: row.completed };
  });
  return { schemaVersion: 1, hits, next: metadata.next };
}
