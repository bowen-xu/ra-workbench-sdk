import { expect, it, vi } from "vitest";
import fixture from "../fixtures/agent/conversation-search.json";
import { AgentCatalogDecodeError, decodeAgentSearchPage, type AgentSearchRequest } from "../../packages/core/src/agent/index";
import { createAgentSearchGateway } from "../../packages/data/src/agent/index";

const request: AgentSearchRequest = { term: "  跨片段  ", scope: { archived: false, limit: 10, before: null,
  binding: { kind: "manuscript", resourceId: "original-host" } } };
it("reads the shared Rust search fixture without history, runtime, or provider calls", async () => {
  const invoke = vi.fn(async () => fixture);
  const result = await createAgentSearchGateway(invoke).search(request);
  expect(result.hits[0]?.startSeq).toBe(12);
  expect(result.hits[0]?.completed).toBe(false);
  expect(invoke).toHaveBeenCalledExactlyOnceWith("agent_search_conversations", { request: { ...request, term: "跨片段" } });
});
it("decodes title hits and rejects incomplete or unsafe message anchors", () => {
  const hit = fixture.hits[0]!;
  const title = { ...hit, excerpt: hit.conversation.title, itemId: null, turnId: null, startSeq: null, completed: true };
  expect(decodeAgentSearchPage({ ...fixture, hits: [title] }).hits[0]?.itemId).toBeNull();
  for (const invalid of [
    { ...hit, startSeq: 14 }, { ...hit, startSeq: 0 }, { ...hit, startSeq: 1.5 },
    { ...hit, turnId: null }, { ...hit, itemId: "bad" }, { ...hit, itemId: "00000000-0000-0000-0000-000000000000" },
    { ...hit, excerpt: "🙂".repeat(321) }, { ...hit, rawProviderState: "not-searchable" },
    { ...title, completed: false }, { ...title, excerpt: "not the title" }, { ...title, turnId: hit.turnId },
  ]) expect(() => decodeAgentSearchPage({ ...fixture, hits: [invalid] })).toThrow(AgentCatalogDecodeError);
  expect(() => decodeAgentSearchPage({ ...fixture, hits: [hit, hit] })).toThrow(AgentCatalogDecodeError);
  expect(() => decodeAgentSearchPage({ ...fixture, schemaVersion: 2 })).toThrow(AgentCatalogDecodeError);
});
it("validates query limits and archive scope, preserving failures without automatic retry", async () => {
  const invoke = vi.fn(async () => fixture);
  const gateway = createAgentSearchGateway(invoke);
  for (const term of ["", " ", "\0", "🙂".repeat(201)]) {
    await expect(gateway.search({ ...request, term })).rejects.toBeInstanceOf(AgentCatalogDecodeError);
  }
  for (const limit of [0, 101, 1.5]) {
    await expect(gateway.search({ ...request, scope: { ...request.scope, limit } })).rejects.toBeInstanceOf(AgentCatalogDecodeError);
  }
  expect(invoke).not.toHaveBeenCalled();
  await expect(gateway.search({ ...request, scope: { ...request.scope, archived: true } })).rejects.toBeInstanceOf(AgentCatalogDecodeError);
  invoke.mockRejectedValueOnce("unavailable");
  await expect(gateway.search(request)).rejects.toBe("unavailable");
  expect(invoke).toHaveBeenCalledTimes(2);
});
