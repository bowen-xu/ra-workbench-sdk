import {expect,it,vi} from "vitest";
import {AgentSteeringController} from "./steeringController";
const scope={conversationId:"conversation",turnId:"turn",scope:{kind:"note",resourceId:"note"}};
it("freezes steering owner before send and retains it after an ambiguous retry",async()=>{
  let currentOwner="old-scene";
  const steps:string[]=[];
  const capture=vi.fn(()=>{const frozen=currentOwner;return async(inputId:string)=>{steps.push(`freeze:${inputId}:${frozen}`);};});
  const send=vi.fn(async()=>{steps.push("send");if(send.mock.calls.length===1){currentOwner="new-scene";throw new Error("lost");}});
  const controller=new AgentSteeringController(send,()=>"stable",capture);
  expect(await controller.submit(scope,"text")).toBe(false);expect(await controller.retry()).toBe(true);
  expect(steps).toEqual(["freeze:stable:old-scene","send","send"]);expect(capture).toHaveBeenCalledOnce();
});
it("does not send steering when owner persistence fails",async()=>{
  const send=vi.fn(), rejection=vi.fn();
  const controller=new AgentSteeringController(send,()=>"stable",()=>async()=>{throw new Error("storage failure");});
  expect(await controller.submit(scope,"text",undefined,rejection)).toBe(false);
  expect(send).not.toHaveBeenCalled();expect(rejection).toHaveBeenCalledOnce();
  expect(controller.getSnapshot()).toMatchObject({phase:"rejected",awaitingHistory:[]});
});
it("keeps an unknown admission on its original ID even after text, turn and later rejection change",async()=>{
  const send=vi.fn().mockRejectedValueOnce(new Error("lost reply")).mockRejectedValueOnce({code:"closed"}).mockResolvedValue({});
  const id=vi.fn(()=>"stable"),controller=new AgentSteeringController(send,id);
  await controller.submit(scope,"original");expect(controller.getSnapshot().phase).toBe("uncertain");
  expect(await controller.submit({...scope,turnId:"next"},"changed")).toBe(false);
  await controller.retry();expect(controller.getSnapshot().phase).toBe("uncertain");
  await controller.retry();expect(controller.getSnapshot().phase).toBe("accepted");
  expect(send.mock.calls[0]).toEqual(send.mock.calls[2]);expect(id).toHaveBeenCalledOnce();
});
it("first explicit rejection retains text and allows a deliberate new attempt",async()=>{
  const send=vi.fn().mockRejectedValueOnce({code:"closed"}).mockResolvedValue({});
  const id=vi.fn().mockReturnValueOnce("first").mockReturnValueOnce("second");
  const controller=new AgentSteeringController(send,id);
  await controller.submit(scope,"first text");expect(controller.getSnapshot().phase).toBe("rejected");
  expect(await controller.retry()).toBe(false);await controller.submit({...scope,turnId:"new turn"},"second text");
  expect(send.mock.calls[1]?.[0]).toMatchObject({turnId:"new turn",inputId:"second",text:"second text"});
});
it("captures nested scope separately from caller and transport and excludes concurrent sends",async()=>{
  let finish!:()=>void;
  const send=vi.fn(request=>{request.scope.resourceId="transport";return new Promise<void>(done=>{finish=done;});});
  const controller=new AgentSteeringController(send,()=>"id");const mutable=structuredClone(scope);
  const pending=controller.submit(mutable,"text");mutable.scope.resourceId="caller";
  expect(await controller.submit(scope,"other")).toBe(false);expect(await controller.retry()).toBe(false);
  finish();expect(await pending).toBe(true);expect(controller.getSnapshot().request?.scope.resourceId).toBe("note");
});
it("rejects invalid UTF-8 and oversize text before invoking a provider adapter",async()=>{
  const send=vi.fn(),controller=new AgentSteeringController(send,()=>"id");
  for(const text of [" ","\ud800","界".repeat(21846)])expect(await controller.submit(scope,text)).toBe(false);
  expect(send).not.toHaveBeenCalled();
});
it("disposal fences late replies and cannot accept new work",async()=>{
  let finish!:()=>void;const send=vi.fn(()=>new Promise<void>(done=>{finish=done;}));
  const controller=new AgentSteeringController(send,()=>"id");const changed=vi.fn();controller.subscribe(changed);
  const pending=controller.submit(scope,"text");controller.dispose();changed.mockClear();finish();
  expect(await pending).toBe(false);expect(changed).not.toHaveBeenCalled();expect(await controller.submit(scope,"new")).toBe(false);
});
it("accepts exact completed history evidence and does not downgrade it on a late transport failure",async()=>{
  let reject!:(error:unknown)=>void;
  const controller=new AgentSteeringController(vi.fn(()=>new Promise((_done,fail)=>{reject=fail;})),()=>"input");
  const pending=controller.submit(scope,"original");
  const projection={conversationId:"conversation",turns:new Map([["turn",{items:new Map([["input",{kind:{type:"userMessage"},completed:true,interrupted:false,text:"original"}]])}]])};
  expect(controller.observeHistory({...projection,conversationId:"other"} as never)).toBeNull();
  expect(controller.observeHistory(projection as never)).toBe("original");reject(new Error("late response loss"));
  expect(await pending).toBe(true);expect(controller.getSnapshot().phase).toBe("accepted");
});
it("ignores incomplete history and fences an old send after observed acceptance permits a new input",async()=>{
  let reject!:(error:unknown)=>void;const send=vi.fn().mockImplementationOnce(()=>new Promise((_done,fail)=>{reject=fail;})).mockResolvedValue({});
  const controller=new AgentSteeringController(send,vi.fn().mockReturnValueOnce("one").mockReturnValueOnce("two"));
  const pending=controller.submit(scope,"first");
  const projection={conversationId:"conversation",turns:new Map([["turn",{items:new Map([["one",{kind:{type:"userMessage"},completed:false,interrupted:false,text:"first"}]])}]])};
  expect(controller.observeHistory(projection as never)).toBeNull();projection.turns.get("turn")!.items.get("one")!.completed=true;
  expect(controller.observeHistory(projection as never)).toBe("first");await controller.submit(scope,"second");
  reject(new Error("late failure"));expect(await pending).toBe(false);
  expect(controller.getSnapshot().request?.text).toBe("second");expect(controller.getSnapshot().phase).toBe("accepted");
});
