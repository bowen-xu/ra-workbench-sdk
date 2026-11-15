import {expect,it,vi} from "vitest";
import {AgentSteeringRegistry} from "./steeringRegistry";
const scope={conversationId:"conversation",turnId:"turn",manuscriptId:"one"};

it("retains an in-flight request without a host and retries its original receipt after reattachment",async()=>{
  let fail!:(error:unknown)=>void;
  const send=vi.fn().mockImplementationOnce(()=>new Promise((_resolve,reject)=>{fail=reject;})).mockResolvedValue({});
  const registry=new AgentSteeringRegistry<typeof scope>(send,()=>"original"),ack=vi.fn();
  const first=registry.acquire("host","conversation")!;
  expect(registry.hasPending()).toBe(false);
  const pending=first.controller.submit(scope,"original text",ack);first.release();
  expect(registry.hasPending()).toBe(true);
  fail(new Error("lost reply"));await pending;
  expect(registry.hasPending()).toBe(true);
  const second=registry.acquire("host","conversation")!;
  expect(second.controller).toBe(first.controller);expect(second.controller.getSnapshot().phase).toBe("uncertain");
  expect(await second.controller.submit({...scope,turnId:"next"},"other text")).toBe(false);
  await second.controller.retry();expect(ack).toHaveBeenCalledOnce();expect(send.mock.calls[0]).toEqual(send.mock.calls[1]);
  expect(registry.hasPending()).toBe(true); // Accepted input still awaits original committed history.
  second.release();const third=registry.acquire("host","conversation")!;
  expect(third.controller).toBe(first.controller);expect(third.controller.getSnapshot().awaitingHistory).toEqual([expect.objectContaining({inputId:"original",text:"original text"})]);third.release();registry.dispose();
});

it("does not retain a definitively rejected steer and never retries while querying",async()=>{
  const send=vi.fn().mockRejectedValue({code:"closed"});
  const registry=new AgentSteeringRegistry<typeof scope>(send,()=>"id");
  const lease=registry.acquire("opaque key","conversation")!;
  expect(await lease.controller.submit(scope,"text")).toBe(false);
  const snapshot=lease.controller.getSnapshot();
  expect(registry.hasPending()).toBe(false);
  expect(registry.hasPending()).toBe(false);
  expect(lease.controller.getSnapshot()).toBe(snapshot);
  expect(send).toHaveBeenCalledOnce();
  lease.release();registry.dispose();
});

it("retains detached admitted input until committed history arrives",async()=>{
  let finish!:()=>void;
  const registry=new AgentSteeringRegistry<typeof scope>(()=>new Promise<void>(resolve=>{finish=resolve;}),()=>"id");
  const first=registry.acquire("host","conversation")!,ack=vi.fn();
  const pending=first.controller.submit(scope,"text",ack);first.release();finish();expect(await pending).toBe(true);
  expect(ack).toHaveBeenCalledOnce();expect(registry.acquire("host","conversation")!.controller.getSnapshot().awaitingHistory).toEqual([expect.objectContaining({inputId:"id",text:"text"})]);registry.dispose();
});

it("isolates hosts and roots and holds entries while any subscriber remains",async()=>{
  const send=vi.fn().mockRejectedValue(new Error("unknown"));
  const registry=new AgentSteeringRegistry<typeof scope>(send,()=>"id"),other=new AgentSteeringRegistry<typeof scope>(send,()=>"id");
  const first=registry.acquire("one","conversation")!,second=registry.acquire("one","conversation")!;
  expect(first.controller).toBe(second.controller);first.release();first.release();
  await second.controller.submit(scope,"one");
  expect(registry.acquire("two","conversation")!.controller.getSnapshot().phase).toBe("idle");
  expect(other.acquire("one","conversation")!.controller.getSnapshot().phase).toBe("idle");
  expect(()=>registry.acquire("one","wrong")).toThrow("scope mismatch");
  second.release();registry.dispose();other.dispose();
});

it("confirmed deletion fences late acceptance and refuses reacquisition",async()=>{
  let finish!:()=>void;
  const registry=new AgentSteeringRegistry<typeof scope>(()=>new Promise<void>(resolve=>{finish=resolve;}),()=>"id");
  const first=registry.acquire("host","conversation")!,ack=vi.fn();
  const pending=first.controller.submit(scope,"text",ack);registry.forgetConversation("conversation");finish();
  expect(await pending).toBe(false);expect(ack).not.toHaveBeenCalled();expect(registry.acquire("host","conversation")).toBeNull();
  first.release();expect(registry.acquire("other","unrelated")).not.toBeNull();registry.dispose();
});

it("survives immediate root effect replay but disposes pending work on final shutdown",async()=>{
  const registry=new AgentSteeringRegistry<typeof scope>(vi.fn().mockRejectedValue(new Error("lost")),()=>"id");
  const release=registry.retain(),first=registry.acquire("host","conversation")!;
  await first.controller.submit(scope,"text");first.release();release();const secondRelease=registry.retain();
  await Promise.resolve();expect(registry.acquire("host","conversation")!.controller).toBe(first.controller);
  secondRelease();await Promise.resolve();expect(registry.acquire("host","conversation")).toBeNull();
  expect(await first.controller.retry()).toBe(false);
});
