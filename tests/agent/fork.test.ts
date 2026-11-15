import { describe, expect, it, vi } from "vitest";
import { AgentCatalogDecodeError, decodeAgentForkRequest, decodeAgentForkResponse } from "../../packages/core/src/agent";
import { createAgentForkGateway } from "../../packages/data/src/agent";
import fixture from "../fixtures/agent/conversation-fork.json";

const request = { childId: fixture.conversation.id, parentId: fixture.parentId, throughTurnId: fixture.throughTurnId,
  binding: { kind: "manuscript" as const, resourceId: "draft" } };
describe("fork protocol", () => {
  it("uses the Rust fixture and preserves later child state on replay", async () => {
    expect(decodeAgentForkResponse(fixture)).toEqual(fixture);
    const replay = { ...fixture, conversation: { ...fixture.conversation, title: "Renamed", archived: true, durableCount: 21 } };
    const invoke = vi.fn().mockResolvedValueOnce(fixture).mockResolvedValueOnce(replay);
    const gateway = createAgentForkGateway(invoke);
    expect(await gateway.fork(request)).toEqual(fixture);
    expect(await gateway.fork(request)).toEqual(replay);
    expect(invoke.mock.calls).toEqual([["agent_fork_conversation", { request }], ["agent_fork_conversation", { request }]]);
  });
  it("rejects malformed identities, bounds, schemas and unrequested capabilities", () => {
    for (const invalid of [
      { ...request, childId: request.parentId }, { ...request, throughTurnId: "00000000-0000-0000-0000-000000000000" },
      { ...request, parentId: "bad" }, { ...request, startModel: true }, { ...request, binding: null },
      { ...request, binding: { kind: "shell", resourceId: "draft" } },
      { ...request, binding: { kind: "note", resourceId: "🙂".repeat(257) } },
      { ...request, binding: { kind: "note", resourceId: "draft", permission: "write" } },
    ]) expect(() => decodeAgentForkRequest(invalid)).toThrow(AgentCatalogDecodeError);
    for (const invalid of [
      { ...fixture, schemaVersion: 2 }, { ...fixture, parentEndSeq: 0 }, { ...fixture, parentEndSeq: 9 },
      { ...fixture, parentEndSeq: 1.5 }, { ...fixture, parentEndSeq: Number.MAX_SAFE_INTEGER + 1 },
      { ...fixture, parentId: fixture.conversation.id }, { ...fixture, turn: {} },
      { ...fixture, conversation: { ...fixture.conversation, id: "00000000-0000-0000-0000-000000000000" } },
    ]) expect(() => decodeAgentForkResponse(invalid)).toThrow(AgentCatalogDecodeError);
  });
  it("does not retry ambiguous failures or accept a result for another branch", async () => {
    const invoke = vi.fn().mockRejectedValueOnce("unavailable").mockResolvedValueOnce({ ...fixture, throughTurnId: request.parentId });
    const gateway = createAgentForkGateway(invoke);
    await expect(gateway.fork(request)).rejects.toBe("unavailable"); expect(invoke).toHaveBeenCalledOnce();
    await expect(gateway.fork(request)).rejects.toBeInstanceOf(AgentCatalogDecodeError);
    await expect(gateway.fork({ ...request, childId: "bad" })).rejects.toBeInstanceOf(AgentCatalogDecodeError);
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});
