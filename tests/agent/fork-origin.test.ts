import { expect, it, vi } from "vitest";
import { AgentCatalogDecodeError, decodeAgentForkOriginRequest, decodeAgentForkOriginResponse } from "../../packages/core/src/agent";
import { createAgentForkOriginGateway } from "../../packages/data/src/agent";
import fixture from "../fixtures/agent/conversation-fork-origin.json";
const request = { conversationId: fixture.conversationId, binding: { kind: "note" as const, resourceId: "note" } };
it("matches the Rust origin wire, keeps archived parents and distinguishes roots from failures", async () => {
  expect(decodeAgentForkOriginResponse(fixture)).toEqual(fixture);
  const root = { ...fixture, origin: null };
  const invoke = vi.fn().mockResolvedValueOnce(fixture).mockResolvedValueOnce(root).mockRejectedValueOnce("notFound");
  const gateway = createAgentForkOriginGateway(invoke);
  expect(await gateway.read(request)).toEqual(fixture); expect(await gateway.read(request)).toEqual(root);
  await expect(gateway.read(request)).rejects.toBe("notFound");
  expect(invoke.mock.calls).toEqual(Array(3).fill(["agent_read_conversation_fork_origin", { request }]));
});
it("rejects unknown fields, missing lineage, invalid scopes and mismatched response identities", async () => {
  for (const invalid of [{ ...request, permission: "write" }, { ...request, binding: null },
    { ...request, conversationId: "00000000-0000-0000-0000-000000000000" }, { ...request, binding: { kind: "shell", resourceId: "note" } },
    { ...request, binding: { kind: "note", resourceId: "\0" } }]) expect(() => decodeAgentForkOriginRequest(invalid)).toThrow(AgentCatalogDecodeError);
  for (const invalid of [{ ...fixture, origin: undefined }, { ...fixture, schemaVersion: 2 }, { ...fixture, origin: { ...fixture.origin, parentEndSeq: 0 } },
    { ...fixture, origin: { ...fixture.origin, parentEndSeq: 9 } }, { ...fixture, origin: { ...fixture.origin, parentEndSeq: 1.5 } },
    { ...fixture, origin: { ...fixture.origin, parentEndSeq: Number.MAX_SAFE_INTEGER + 1 } },
    { ...fixture, origin: { ...fixture.origin, parent: { ...fixture.origin.parent, id: fixture.conversationId } } },
    { ...fixture, origin: { ...fixture.origin, throughTurnId: "bad" } }]) expect(() => decodeAgentForkOriginResponse(invalid)).toThrow(AgentCatalogDecodeError);
  const invoke = vi.fn().mockResolvedValue({ ...fixture, conversationId: fixture.origin.throughTurnId });
  await expect(createAgentForkOriginGateway(invoke).read(request)).rejects.toBeInstanceOf(AgentCatalogDecodeError);
  expect(invoke).toHaveBeenCalledOnce();
});
