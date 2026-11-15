import {expect, it, vi} from "vitest";
import {AgentSteeringController} from "./steeringController";

const scope = {conversationId: "11111111-1111-4111-8111-111111111111", turnId: "22222222-2222-4222-8222-222222222222"};
const next = "33333333-3333-4333-8333-333333333333";

it("checks admission after synchronous sending listeners without a persistence wait", async () => {
  let disabled = false;
  const send = vi.fn(async () => ({})), owner = new AgentSteeringController(send, () => "input");
  const unsubscribe = owner.subscribe(() => {if (owner.getSnapshot().phase === "sending") disabled = true;});
  expect(await owner.submit(scope, "keep", undefined, undefined, undefined, undefined, undefined, () => disabled)).toBe(false);
  expect(send).not.toHaveBeenCalled(); expect(owner.getSnapshot().status).toContain("inputId=input");
  unsubscribe(); owner.dispose();
});

it("checks its captured instance after owner persistence without consuming the draft", async () => {
  let disabled = false, release!: () => void;
  const save = vi.fn(() => new Promise<void>(resolve => {release = resolve;}));
  const send = vi.fn(async () => ({})), acknowledge = vi.fn(), rejected = vi.fn(), confirmed = vi.fn(), fallback = vi.fn();
  const owner = new AgentSteeringController(send, () => "input", () => save);
  const work = owner.submit(scope, "keep", acknowledge, rejected, undefined, confirmed, fallback, () => disabled);
  expect(save).toHaveBeenCalledOnce(); disabled = true; release();
  expect(await work).toBe(false); expect(send).not.toHaveBeenCalled(); expect(acknowledge).not.toHaveBeenCalled();
  expect(rejected).toHaveBeenCalledOnce(); expect(fallback).not.toHaveBeenCalled(); expect(confirmed).not.toHaveBeenCalled();
  expect(owner.getSnapshot()).toMatchObject({phase: "rejected", awaitingHistory: []});
  expect(owner.getSnapshot().status).toMatch(/^WRITING_RUNTIME_UNAVAILABLE：/u); owner.dispose();
});

it("retains the exact attempted steer and acknowledgment through a disabled retry", async () => {
  let disabled = false;
  const send = vi.fn(async () => ({})).mockImplementationOnce(async () => {disabled = true; throw Error("lost reply");});
  const acknowledge = vi.fn(), reject = vi.fn(), owner = new AgentSteeringController(send, () => "original");
  expect(await owner.submit(scope, "same text", acknowledge, reject, undefined, undefined, undefined, () => disabled)).toBe(false);
  expect(owner.getSnapshot().phase).toBe("uncertain"); expect(await owner.retry()).toBe(true);
  expect(send).toHaveBeenCalledTimes(2); expect(send.mock.calls[1]).toEqual(send.mock.calls[0]);
  expect(acknowledge).toHaveBeenCalledOnce(); expect(reject).not.toHaveBeenCalled(); owner.dispose();
});

it("does not treat a definitive old-turn mismatch as permission to dispatch a new turn", async () => {
  let disabled = false;
  const send = vi.fn(async () => ({})).mockImplementationOnce(async () => {disabled = true; throw {code: "expectedTurnMismatch", actualTurnId: next};});
  const rejected = vi.fn(), fallback = vi.fn(), owner = new AgentSteeringController(send, () => "input");
  expect(await owner.submit(scope, "keep", undefined, rejected, undefined, undefined, fallback, () => disabled)).toBe(false);
  expect(send).toHaveBeenCalledOnce(); expect(rejected).toHaveBeenCalledOnce(); expect(fallback).not.toHaveBeenCalled();
  expect(owner.getSnapshot()).toMatchObject({phase: "rejected", request: {turnId: next}, awaitingHistory: []}); owner.dispose();
});
