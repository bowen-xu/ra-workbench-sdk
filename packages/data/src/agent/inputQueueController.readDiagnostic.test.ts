import { expect, it, vi } from "vitest";
import { AgentInputQueueController } from "./inputQueueController";

it("retains the original read error and scope until a successful retry", async () => {
  const scope = {conversationId: "11111111-1111-4111-8111-111111111111"};
  const cause = {code: "unavailable", status: 503};
  const queue = {schemaVersion: 1 as const, conversationId: scope.conversationId, revision: 0, paused: false, preparingInputId: null, inputs: []};
  const read = vi.fn().mockRejectedValueOnce(cause).mockResolvedValueOnce(queue);
  const controller = new AgentInputQueueController({read, edit: vi.fn()}, scope, () => "request");
  await controller.reload();
  expect(controller.getSnapshot().readFailure).toEqual({cause, scope});
  await controller.reload();
  expect(controller.getSnapshot()).toMatchObject({error: null, readFailure: null});
  controller.dispose();
});
