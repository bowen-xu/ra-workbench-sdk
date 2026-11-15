/** A user-confirmed concept-network trace selected for one Agent submission. */
export interface AgentRetrievalSelection {
  readonly traceId: string;
  readonly query: string;
}

/** Decode the shared retrieval selection before any host-specific admission. */
export function decodeAgentRetrievalSelection(value: unknown): AgentRetrievalSelection {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid retrieval selection");
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== 2 || typeof row.traceId !== "string" || typeof row.query !== "string"
    || !row.traceId.trim() || !row.query.trim() || row.traceId.includes("\0") || row.query.includes("\0")
    || utf8Length(row.traceId) > 160 || utf8Length(row.query) > 16_384) throw new Error("Invalid retrieval selection");
  return { traceId: row.traceId, query: row.query };
}
import { utf8Length } from "./workspaceDecoding";
