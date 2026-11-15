import { expect, it, vi } from "vitest";
import { createAgentConversationProjection, type AgentConversationProjection, type AgentQueueState } from "@research-assistant/core/agent";
import { AgentInputQueueRegistry } from "./inputQueueRegistry";
import { AgentSteeringRegistry } from "./steeringRegistry";

const conversationId = "11111111-1111-4111-8111-111111111111";
const turnId = "22222222-2222-4222-8222-222222222222";
const inputId = "33333333-3333-4333-8333-333333333333";
const scope = { conversationId, manuscriptId: "44444444-4444-4444-8444-444444444444" };
const steerScope = { ...scope, turnId };

it("keeps a queue-to-steer removal alive across host detach and lost steer receipt", async () => {
  let lose!: (reason: unknown) => void;
  const queue: AgentQueueState = { schemaVersion: 1, conversationId, revision: 1, paused: false, preparingInputId: null,
    inputs: [{ inputId, text: "follow up" }] };
  let finishRemoval!: (value: AgentQueueState) => void;
  const queueGateway = {
    read: vi.fn().mockResolvedValue(queue),
    edit: vi.fn(() => new Promise<AgentQueueState>(resolve => { finishRemoval = resolve; })),
  };
  const queueOwners = new AgentInputQueueRegistry<typeof scope, AgentQueueState>(queueGateway,
    value => JSON.stringify([value.manuscriptId, value.conversationId]), () => "queue-request");
  const firstQueue = queueOwners.acquire(scope)!;
  await firstQueue.controller.reload();
  // This second lease represents the transfer hold installed before Steer.
  const transferQueue = queueOwners.acquire(scope)!;

  const send = vi.fn().mockImplementationOnce(() => new Promise((_resolve, reject) => { lose = reject; }))
    .mockResolvedValueOnce({});
  const steeringOwners = new AgentSteeringRegistry<typeof steerScope>(send, () => "steer-input");
  const firstSteer = steeringOwners.acquire("host", conversationId)!;
  const removeAfterHistory = () => transferQueue.controller.edit({ type: "remove", inputId }).finally(transferQueue.release);
  const pending = firstSteer.controller.submit(steerScope, "follow up", undefined, transferQueue.release, undefined, removeAfterHistory);
  firstQueue.release();
  firstSteer.release();
  lose(new Error("connection closed"));
  await pending;

  // Reattaching another host must find the same uncertain Steer controller;
  // the queue controller is also still retained by the transfer lease.
  const secondSteer = steeringOwners.acquire("host", conversationId)!;
  expect(secondSteer.controller).toBe(firstSteer.controller);
  expect(secondSteer.controller.getSnapshot().phase).toBe("uncertain");
  expect(await secondSteer.controller.retry()).toBe(true);
  expect(queueGateway.edit).not.toHaveBeenCalled();
  const projection: AgentConversationProjection = { ...createAgentConversationProjection(conversationId),
    activeTurn: turnId, turnOrder: [turnId], turns: new Map([[turnId, {
      contextSnapshotId: "snapshot", model: {providerId:"test",modelId:"test",revision:null}, phase:"runningModel", outcome:null,
      itemOrder:["steer-input"],items:new Map([["steer-input",{kind:{type:"userMessage"},text:"follow up",completed:true,interrupted:false}]]),
      attemptOrder:[],attempts:new Map(),inputTokens:null,outputTokens:null,
    }]]) };
  secondSteer.controller.observeHistory(projection);
  expect(queueGateway.edit).toHaveBeenCalledWith(expect.objectContaining({
    conversationId, manuscriptId: scope.manuscriptId, edit: { type: "remove", inputId },
  }));
  expect(secondSteer.controller.getSnapshot().awaitingHistory).toHaveLength(1);
  secondSteer.release();
  const duringRemoval = steeringOwners.acquire("host", conversationId)!;
  expect(duringRemoval.controller).toBe(firstSteer.controller);
  finishRemoval({ ...queue, revision: 2, inputs: [] });
  await vi.waitFor(() => expect(duringRemoval.controller.getSnapshot().awaitingHistory).toEqual([]));

  // The accepted transfer releases its extra lease; a later host receives a
  // fresh queue controller rather than a detached stale owner.
  duringRemoval.release();
  const fresh = queueOwners.acquire(scope)!;
  expect(fresh.controller).not.toBe(transferQueue.controller);
  fresh.release();
  steeringOwners.dispose(); queueOwners.dispose();
});
