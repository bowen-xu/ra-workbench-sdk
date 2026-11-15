import {expect,it,vi} from "vitest";
import {createAgentConversationProjection,type AgentConversationProjection} from "@research-assistant/core/agent";
import {AgentSteeringController} from "./steeringController";

const scope={conversationId:"11111111-1111-4111-8111-111111111111",turnId:"22222222-2222-4222-8222-222222222222"};
const next="33333333-3333-4333-8333-333333333333";
function history(id:string,text:string,completed=true):AgentConversationProjection{
  return {...createAgentConversationProjection(scope.conversationId),activeTurn:scope.turnId,turnOrder:[scope.turnId],turns:new Map([[scope.turnId,{
    contextSnapshotId:"snapshot",model:{providerId:"test",modelId:"test",revision:null},phase:"runningModel",outcome:null,
    itemOrder:[id],items:new Map([[id,{kind:{type:"userMessage"},text,completed,interrupted:false}]]),
    attemptOrder:[],attempts:new Map(),inputTokens:null,outputTokens:null,
  }]])};
}
it("keeps admitted inputs pending until exact completed history and transfers a queued item only once",async()=>{
  const admitted=vi.fn(),confirmed=vi.fn(),send=vi.fn().mockResolvedValue({});
  const controller=new AgentSteeringController(send,vi.fn().mockReturnValueOnce("first").mockReturnValueOnce("second"));
  await controller.submit(scope,"one",admitted,undefined,undefined,confirmed);
  expect(admitted).toHaveBeenCalledOnce();expect(confirmed).not.toHaveBeenCalled();
  await controller.submit(scope,"two");
  expect(controller.getSnapshot().awaitingHistory?.map(item=>item.text)).toEqual(["one","two"]);
  controller.observeHistory(history("first","wrong"));controller.observeHistory(history("first","one",false));
  expect(confirmed).not.toHaveBeenCalled();
  controller.observeHistory(history("first","one"));controller.observeHistory(history("first","one"));
  expect(confirmed).toHaveBeenCalledOnce();expect(controller.getSnapshot().awaitingHistory?.map(item=>item.text)).toEqual(["two"]);
});
it("retains the confirmed input until its queued transfer actually settles",async()=>{
  let finish!:(value:boolean)=>void;
  const transfer=vi.fn(()=>new Promise<boolean>(resolve=>{finish=resolve;}));
  const controller=new AgentSteeringController(vi.fn().mockResolvedValue({}),()=>"original");
  await controller.submit(scope,"one",undefined,undefined,undefined,transfer);
  controller.observeHistory(history("original","one"));
  expect(transfer).toHaveBeenCalledOnce();
  expect(controller.getSnapshot().awaitingHistory?.map(item=>item.inputId)).toEqual(["original"]);
  finish(true);await Promise.resolve();
  expect(controller.getSnapshot().awaitingHistory).toEqual([]);
});
it("retains a failed transfer and retries only the confirmed original without another steer",async()=>{
  const transfer=vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true),send=vi.fn().mockResolvedValue({});
  const controller=new AgentSteeringController(send,()=>"original");
  await controller.submit(scope,"one",undefined,undefined,undefined,transfer);
  controller.observeHistory(history("original","one"));await Promise.resolve();
  expect(controller.getSnapshot().transferFailures).toEqual(["original"]);
  expect(controller.getSnapshot().awaitingHistory?.map(item=>item.inputId)).toEqual(["original"]);
  controller.observeHistory(history("original","one"));expect(transfer).toHaveBeenCalledOnce();
  controller.retryConfirmation("other");expect(transfer).toHaveBeenCalledOnce();
  controller.retryConfirmation("original");await Promise.resolve();
  expect(transfer).toHaveBeenCalledTimes(2);expect(send).toHaveBeenCalledOnce();
  expect(controller.getSnapshot().awaitingHistory).toEqual([]);
});
it("updates only the turn identity and retries a definitive mismatch once",async()=>{
  const send=vi.fn().mockRejectedValueOnce({code:"expectedTurnMismatch",actualTurnId:next}).mockResolvedValue({});
  const controller=new AgentSteeringController(send,()=>"input");
  expect(await controller.submit(scope,"same text")).toBe(true);
  expect(send).toHaveBeenCalledTimes(2);
  expect(send.mock.calls[1]?.[0]).toEqual({...send.mock.calls[0]?.[0],turnId:next});
  expect(controller.getSnapshot().awaitingHistory?.[0]?.turnId).toBe(next);
});
it("queues a twice-rejected mismatch rather than looping or duplicating the input",async()=>{
  const send=vi.fn().mockRejectedValueOnce({code:"expectedTurnMismatch",actualTurnId:next})
    .mockRejectedValue({code:"expectedTurnMismatch",actualTurnId:scope.turnId});
  const fallback=vi.fn().mockResolvedValue(true),rejected=vi.fn();
  const controller=new AgentSteeringController(send,()=>"input");
  await controller.submit(scope,"keep",undefined,rejected,undefined,undefined,fallback);
  expect(send).toHaveBeenCalledTimes(2);expect(rejected).toHaveBeenCalledOnce();expect(fallback).toHaveBeenCalledOnce();
  expect(controller.getSnapshot().awaitingHistory).toEqual([]);
});
it.each(["closed","capacity","notSteerable","activeTurnNotSteerable"])("preserves a definitively rejected %s input in the queue",async code=>{
  const fallback=vi.fn().mockResolvedValue(true),ack=vi.fn(),confirmed=vi.fn();
  const controller=new AgentSteeringController(vi.fn().mockRejectedValue({code}),()=>"original-input");
  await controller.submit(scope,"keep",ack,undefined,undefined,confirmed,fallback);
  expect(fallback).toHaveBeenCalledWith({...scope,inputId:"original-input",text:"keep"});
  expect(ack).not.toHaveBeenCalled();expect(confirmed).not.toHaveBeenCalled();
  expect(controller.getSnapshot().status).toContain("下一轮队列");
});
it("never retargets an unknown admission even if its retry reports a newer active turn",async()=>{
  const send=vi.fn().mockRejectedValueOnce(new Error("reply lost")).mockRejectedValue({code:"expectedTurnMismatch",actualTurnId:next});
  const fallback=vi.fn().mockResolvedValue(true),controller=new AgentSteeringController(send,()=>"original");
  await controller.submit(scope,"keep",undefined,undefined,undefined,undefined,fallback);await controller.retry();
  expect(send.mock.calls[0]).toEqual(send.mock.calls[1]);expect(fallback).not.toHaveBeenCalled();
  expect(controller.getSnapshot().phase).toBe("uncertain");
});
it.each(["invalid","conflict"])("leaves %s drafts intact without queuing invalid resources",async code=>{
  const fallback=vi.fn(),controller=new AgentSteeringController(vi.fn().mockRejectedValue({code}),()=>"input");
  await controller.submit(scope,"draft",undefined,undefined,undefined,undefined,fallback);
  expect(fallback).not.toHaveBeenCalled();expect(controller.getSnapshot().request?.text).toBe("draft");
});
