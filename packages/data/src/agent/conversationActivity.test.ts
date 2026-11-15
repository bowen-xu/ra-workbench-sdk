import { expect, it, vi } from "vitest";
import { createAgentCatalogGateway } from "./index";
import { decodeAgentConversationActivity } from "@research-assistant/core/agent";

const running = [{id: "11111111-1111-4111-8111-111111111111", internal: true}];
it("reads only versioned lifecycle metadata scoped to its host", async () => {
  const invoke = vi.fn(async () => ({schemaVersion: 1, running}));
  const gateway = createAgentCatalogGateway(invoke), binding = {kind: "note" as const, resourceId: "note-a"};
  await expect(gateway.activity!({binding})).resolves.toEqual(running);
  expect(invoke).toHaveBeenCalledWith("agent_read_conversation_activity", {request: {binding}});
});
it.each([
  {schemaVersion: 2, running}, {schemaVersion: 1, running: [...running, ...running]},
  {schemaVersion: 1, running: [{...running[0], internal: "yes"}]},
  {schemaVersion: 1, running: [{...running[0], id: "invalid"}]},
  {schemaVersion: 1, running, text: "unexpected history"},
])("rejects malformed or widened activity responses: %j", value => {
  expect(() => decodeAgentConversationActivity(value)).toThrow();
});
