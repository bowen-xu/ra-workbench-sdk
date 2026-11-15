import { expect, it, vi } from "vitest";
import { decodeAgentForkRequest, decodeAgentForkOriginRequest } from "@research-assistant/core/agent";
import { createAgentCatalogGateway, createAgentCreationGateway } from "./index";
import { createAgentForkOriginGateway } from "./fork";
const conversationId = "11111111-1111-4111-8111-111111111111";
const binding = { kind: "readingNote" as const, resourceId: "retained-note" };

it("passes an explicit reading-note binding unchanged through creation, directory and origin gateways", async () => {
  const request = {operationId: crypto.randomUUID(), id: conversationId, binding};
  const proof = {schemaVersion: 1, operationId: request.operationId, conversationId,
    family: "agent.conversation.create_bound", epoch: crypto.randomUUID(), sqlFence: "0", replayed: false, result: null};
  const invoke = vi.fn().mockResolvedValueOnce(proof).mockResolvedValueOnce({schemaVersion: 1, conversations: [], next: null})
    .mockResolvedValueOnce({schemaVersion: 1, conversationId, origin: null});
  const catalog = createAgentCatalogGateway(invoke);
  await createAgentCreationGateway(invoke).createBound(request);
  await catalog.list({binding, archived: false, limit: 50, before: null});
  await createAgentForkOriginGateway(invoke).read({conversationId, binding});
  expect(invoke.mock.calls.map(([, args]) => args.request.binding)).toEqual([binding, binding, binding]);
  expect(invoke.mock.calls.map(([command]) => command)).toEqual(["agent_create_bound_conversation", "agent_list_conversations", "agent_read_conversation_fork_origin"]);
});
it("decodes reading-note fork scope independently and rejects invented kinds", () => {
  const request = {childId: "22222222-2222-4222-8222-222222222222", parentId: conversationId,
    throughTurnId: "33333333-3333-4333-8333-333333333333", binding};
  expect(decodeAgentForkRequest(request).binding).toEqual(binding);
  expect(decodeAgentForkOriginRequest({conversationId, binding}).binding).toEqual(binding);
  for (const kind of ["reading", "noteBlock", "reading_note", "unknown"]) {
    expect(() => decodeAgentForkRequest({...request, binding: {...binding, kind}})).toThrow();
    expect(() => decodeAgentForkOriginRequest({conversationId, binding: {...binding, kind}})).toThrow();
  }
});
