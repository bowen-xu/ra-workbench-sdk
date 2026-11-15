import { describe, expect, it, vi } from "vitest";
import { createAgentCatalogGateway } from "../../packages/data/src/agent/index";
import { decodeAgentCatalogPage, decodeAgentRenameResponse } from "../../packages/core/src/agent/index";
import fixture from "../fixtures/agent-catalog-v1.json";

describe("agent catalog IPC", () => {
  it("rejects rename proofs for another conversation or operation without retry", async () => {
    const original = fixture.conversations[0]!;
    const invoke = vi.fn(); const gateway = createAgentCatalogGateway(invoke);
    const request = { operationId: "00000000-0000-0000-0000-000000000003", id: original.id, expectedTitle: original.title, title: "New title" };
    const proof = {schemaVersion: 1, operationId: request.operationId, conversationId: original.id,
      family: "agent.conversation.rename", epoch: "00000000-0000-0000-0000-000000000004", sqlFence: "0", replayed: false, result: null};
    for (const patch of [{ conversationId: "00000000-0000-0000-0000-000000000099" }, { operationId: "00000000-0000-0000-0000-000000000005" }]) {
      invoke.mockClear().mockResolvedValue({ ...proof, ...patch });
      await expect(gateway.rename(request)).rejects.toThrow("Invalid or unsupported agent catalog response");
      expect(invoke).toHaveBeenCalledExactlyOnceWith("agent_rename_conversation", { request });
    }
  });
  it("matches the native fixture and rename representation", () => {
    expect(decodeAgentCatalogPage(fixture)).toEqual(fixture);
    const rename = { schemaVersion: 1, conversation: fixture.conversations[0] };
    expect(decodeAgentRenameResponse(rename)).toEqual(rename);
  });
  it("rejects future schemas, extra fields, duplicate entries and invalid cursors", () => {
    for (const patch of [{ schemaVersion: 2 }, { extra: true }, { conversations: [...fixture.conversations, ...fixture.conversations] },
      { next: { ...fixture.next, id: "bad" } }, { conversations: [] }]) {
      expect(() => decodeAgentCatalogPage({ ...fixture, ...patch })).toThrow();
    }
  });
  it("rejects unsafe counts and corrupt summaries without exposing contents", () => {
    for (const patch of [{ durableCount: Number.MAX_SAFE_INTEGER + 1 }, { title: "" }, { archived: 1 }, { createdAt: "secret" }]) {
      expect(() => decodeAgentRenameResponse({ schemaVersion: 1, conversation: { ...fixture.conversations[0], ...patch } }))
        .toThrow("Invalid or unsupported agent catalog response");
    }
  });
});
