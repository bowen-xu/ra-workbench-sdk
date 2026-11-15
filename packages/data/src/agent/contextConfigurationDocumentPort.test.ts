import { expect, it, vi } from "vitest";
import { HbsSession, createStructuredDocumentAdapter, DocumentVersionConflict, type DocumentCheckpoint, type HbsDocumentAdapter } from "@research-assistant/core/hbs";
import { EMPTY_AGENT_CONTEXT, type AgentContextConfigurationSaveIntent, type AgentContextState } from "@research-assistant/core/agent";
import { createContextConfigurationDocumentPort, type ContextConfigurationOutbox } from "./contextConfigurationDocumentPort";
import type { AgentContextConfigurationSaveGateway } from "./contextConfigurationSave";

const conversationId="11111111-1111-4111-8111-111111111111", epoch="22222222-2222-4222-8222-222222222222";
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const resource=(name:string)=>({resource:{kind:"paperMetadata" as const,resourceId:name},label:name});
const initial:AgentContextState={...EMPTY_AGENT_CONTEXT,temporary:[resource("temporary")]};
const later:AgentContextState={schemaVersion:1,persistent:[resource("paper")],temporary:[]};
const adapter=createStructuredDocumentAdapter((a,b)=>a===b?[]:[{fromA:0,toA:a.length,fromB:0,toB:b.length}]) as HbsDocumentAdapter<AgentContextState>;
const settle=async()=>{for(let n=0;n<100;n++)await Promise.resolve();};

it("uses HBS to merge independent configuration changes and preserve same-list conflicts",()=>{
  const base:AgentContextState={schemaVersion:1,persistent:[resource("a")],temporary:[resource("t")]};
  const local={...base,temporary:[]},incoming={...base,persistent:[resource("a"),resource("b")]};
  const disjoint=adapter.merge(base,local,incoming);
  expect(disjoint.value).toEqual({schemaVersion:1,persistent:[resource("a"),resource("b")],temporary:[]});
  expect(disjoint.conflicts).toHaveLength(0);
  const overlapping=adapter.merge(base,incoming,{...base,persistent:[resource("a"),resource("c")]});
  expect(overlapping.value).toEqual(incoming);
  expect(overlapping.conflicts).toHaveLength(1);
  expect(overlapping.conflicts[0]?.path).toEqual(["persistent"]);
});

function fixture(){
  let stored:AgentContextConfigurationSaveIntent|null=null,state=initial,revision=1,sequence=0;
  const receipts=new Map<string,AgentContextConfigurationSaveIntent>();
  const outbox:ContextConfigurationOutbox={run:operation=>operation(),read:async()=>stored,write:async value=>{stored=value?structuredClone(value):null;}};
  const environment=vi.fn(async(request:{operationId:string;conversationId:string})=>({schemaVersion:1 as const,...request,epoch,sqlFence:"0",configuration:{revision,state:structuredClone(state)}}));
  const save=vi.fn(async(intent:AgentContextConfigurationSaveIntent)=>{
    const prior=receipts.get(intent.operationId);
    if(!prior){if(intent.expectedRevision!==revision)throw "confirmationMismatch";state=structuredClone(intent.state);revision++;receipts.set(intent.operationId,structuredClone(intent));}
    return {schemaVersion:1 as const,operationId:intent.operationId,conversationId,epoch,family:"agent.context.configuration.save" as const,sqlFence:"0",replayed:!!prior,result:null};
  });
  const status=vi.fn(async(intent:AgentContextConfigurationSaveIntent)=>receipts.has(intent.operationId)
    ? {type:"committed" as const,proof:{schemaVersion:1 as const,operationId:intent.operationId,conversationId,epoch,family:"agent.context.configuration.save" as const,sqlFence:"0",replayed:true,result:null}}
    : {type:"noSqlReceipt" as const,epoch,sqlFence:"0",closed:false});
  const gateway:AgentContextConfigurationSaveGateway={environment,save,status};
  const port=createContextConfigurationDocumentPort(conversationId,gateway,outbox,()=>id(++sequence));
  return {port,gateway,outbox,save,status,get stored(){return stored;},get state(){return state;},get revision(){return revision;},
    external(value:AgentContextState){state=value;revision++;}};
}

it("retains the original intent on a lost reply and retries exactly that operation",async()=>{
  const f=fixture();expect(f.port.dataEpoch()).toBeNull();await f.port.read();expect(f.port.dataEpoch()).toBe(epoch);const apply=f.save.getMockImplementation()!;
  f.save.mockImplementationOnce(async intent=>{await apply(intent);throw Error("reply lost");});
  const request={id:id(50),expectedVersion:1,saved:later,baseline:later};
  await expect(f.port.commit(request)).rejects.toThrow("reply lost");
  expect(f.stored).toMatchObject({operationId:request.id,expectedEpoch:epoch,expectedRevision:1,state:later});
  const reopened=createContextConfigurationDocumentPort(conversationId,f.gateway,f.outbox,()=>id(51));
  expect(await reopened.inspect()).toBe("committed");expect(f.stored).toBeNull();
  expect((await reopened.read()).saved).toEqual(later);expect(f.save).toHaveBeenCalledOnce();
});

it("keeps an absent receipt unresolved and explicitly retries the same frozen operation",async()=>{
  const f=fixture();await f.port.read();f.save.mockRejectedValueOnce(Error("unknown"));
  const request={id:id(60),expectedVersion:1,saved:later,baseline:later};
  await expect(f.port.commit(request)).rejects.toThrow("unknown");
  expect(await f.port.inspect()).toBe("unconfirmed");expect(f.stored?.operationId).toBe(request.id);
  await expect(f.port.commit({...request,id:id(61)})).rejects.toThrow("CONTEXT_CONFIGURATION_ORIGINAL_PENDING");
  await f.port.retry();expect(f.save.mock.calls[1]).toEqual(f.save.mock.calls[0]);expect(f.stored).toBeNull();
});

it("does not start a mutation if the frozen intent cannot be made durable",async()=>{
  const f=fixture();const outbox:ContextConfigurationOutbox={...f.outbox,write:async()=>{throw Error("local storage failed");}};
  const port=createContextConfigurationDocumentPort(conversationId,f.gateway,outbox,()=>id(91));
  await port.read();await expect(port.commit({id:id(92),expectedVersion:1,saved:later,baseline:later})).rejects.toThrow("local storage failed");
  expect(f.save).not.toHaveBeenCalled();
});

it("stops a revoked initialization after freezing its original request",async()=>{
  const f=fixture();let writable=true;
  const outbox:ContextConfigurationOutbox={...f.outbox,write:async value=>{await f.outbox.write(value);if(value)writable=false;}};
  const port=createContextConfigurationDocumentPort(conversationId,f.gateway,outbox,()=>id(191));await port.read();
  await expect(port.commitGuarded({id:id(192),expectedVersion:1,saved:later,baseline:later},()=>writable))
    .rejects.toMatchObject({message:"CONTEXT_CONFIGURATION_WRITE_REVOKED",intentPersisted:true});
  expect(f.save).not.toHaveBeenCalled();expect(f.stored?.operationId).toBe(id(192));
  writable=true;await port.retry();expect(f.save).toHaveBeenCalledOnce();
});

it("does not freeze an initialization whose authority was revoked before admission",async()=>{
  const f=fixture();await f.port.read();
  await expect(f.port.commitGuarded({id:id(193),expectedVersion:1,saved:later,baseline:later},()=>false))
    .rejects.toMatchObject({message:"CONTEXT_CONFIGURATION_WRITE_REVOKED",intentPersisted:false});
  expect(f.stored).toBeNull();expect(f.save).not.toHaveBeenCalled();
});

it("keeps a committed identity when local receipt cleanup fails",async()=>{
  const f=fixture();let rejectClear=true;
  const outbox:ContextConfigurationOutbox={...f.outbox,write:async value=>{if(value===null&&rejectClear)throw Error("cleanup failed");await f.outbox.write(value);}};
  const port=createContextConfigurationDocumentPort(conversationId,f.gateway,outbox,()=>id(93));await port.read();
  await expect(port.commit({id:id(94),expectedVersion:1,saved:later,baseline:later})).rejects.toThrow("cleanup failed");
  expect(f.stored?.operationId).toBe(id(94));rejectClear=false;
  expect(await port.inspect()).toBe("committed");expect(f.stored).toBeNull();expect(f.save).toHaveBeenCalledOnce();
});

it("reports a confirmed version rejection to HBS with the current snapshot",async()=>{
  const f=fixture();await f.port.read();f.external(later);
  await expect(f.port.commit({id:id(70),expectedVersion:1,saved:initial,baseline:initial})).rejects.toBeInstanceOf(DocumentVersionConflict);
  expect(f.stored).toBeNull();expect(f.state).toEqual(later);
});

it("reconciles an explicitly retried original after a confirmed version conflict",async()=>{
  const f=fixture();await f.port.read();f.save.mockRejectedValueOnce(Error("response unknown"));
  await expect(f.port.commit({id:id(71),expectedVersion:1,saved:later,baseline:later})).rejects.toThrow();
  f.external({...initial,temporary:[]});
  await expect(f.port.retry()).rejects.toBeInstanceOf(DocumentVersionConflict);
  expect(f.stored).toBeNull();expect(f.state).toEqual({...initial,temporary:[]});
});

it("does not silently accept an unsupported candidate baseline",async()=>{
  const f=fixture();await f.port.read();
  await expect(f.port.commit({id:id(80),expectedVersion:1,saved:later,baseline:initial})).rejects.toThrow("CONTEXT_CONFIGURATION_REVIEW_BASELINE_UNSUPPORTED");
  expect(f.save).not.toHaveBeenCalled();expect(f.stored).toBeNull();
});

it("does not inspect or retry an outbox from a different data environment",async()=>{
  const f=fixture();await f.port.read();
  await f.outbox.write({operationId:id(81),conversationId,expectedEpoch:id(82),expectedRevision:1,state:later});
  await expect(f.port.inspect()).rejects.toThrow("CONTEXT_CONFIGURATION_EPOCH_MISMATCH");
  await expect(f.port.retry()).rejects.toThrow("CONTEXT_CONFIGURATION_EPOCH_MISMATCH");
  expect(f.status).not.toHaveBeenCalled();expect(f.save).not.toHaveBeenCalled();
});

it("uses the real HBS session to preserve later edits during an in-flight save",async()=>{
  const f=fixture();const apply=f.save.getMockImplementation()!;let release!:()=>void;
  f.save.mockImplementationOnce(async intent=>{await new Promise<void>(resolve=>{release=resolve;});return apply(intent);});
  let checkpoint:DocumentCheckpoint<AgentContextState>|undefined,sequence=100;
  const session=await HbsSession.open({adapter,port:f.port,requestId:()=>id(++sequence),
    preservation:{load:()=>checkpoint,save:value=>{checkpoint=structuredClone(value);}}});
  const consumed={...initial,temporary:[]};session.edit(consumed);void session.save();await settle();
  expect(f.stored?.state).toEqual(consumed);session.edit(later);void session.save();await settle();release();await settle();
  expect(f.state).toEqual(later);expect(f.revision).toBe(3);expect(session.getSnapshot().content).toEqual(later);
  expect(checkpoint?.content).toEqual(later);session.dispose();
});
