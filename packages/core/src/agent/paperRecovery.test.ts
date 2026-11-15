import { expect, it } from "vitest";
import { decodeAgentPaperRecoveryPage, type AgentPaperRecoveryRequest } from "./paperRecovery";

const scope: AgentPaperRecoveryRequest = { conversationId: "11111111-1111-4111-8111-111111111111", paperId: "paper", after: null, limit: 1 };
const item = { requestId: "22222222-2222-4222-8222-222222222222", turnId: "33333333-3333-4333-8333-333333333333", paperContextSnapshotId: "snap", messageExcerpt: "ask", createdAt: "2026-09-11T00:00:00Z" };
it("accepts an empty bounded page", () => expect(decodeAgentPaperRecoveryPage({ schemaVersion: 1, conversationId: scope.conversationId, paperId: scope.paperId, items: [], nextCursor: null }, scope).items).toHaveLength(0));
it("requires a cursor for a full page", () => expect(() => decodeAgentPaperRecoveryPage({ schemaVersion: 1, conversationId: scope.conversationId, paperId: scope.paperId, items: [item], nextCursor: null }, scope)).toThrow());
it("accepts a full page with its cursor", () => expect(decodeAgentPaperRecoveryPage({ schemaVersion: 1, conversationId: scope.conversationId, paperId: scope.paperId, items: [item], nextCursor: item.requestId }, scope).nextCursor).toBe(item.requestId));
