import { expect, it } from "vitest";
import { HbsSession } from "./session";
import { createNoteDocumentAdapter } from "./adapters";
import { DocumentVersionConflict, type DocumentCheckpoint, type DocumentCommit, type DocumentSnapshot } from "./document";
import { noteBlockId, notePageId, type NoteDocumentV1 } from "../notes";
const calculate = (a: string,b: string) => a===b?[]:[{fromA:0,toA:a.length,fromB:0,toB:b.length}];
const adapter = createNoteDocumentAdapter(calculate);
const doc = (a="old",b="ordinary"): NoteDocumentV1 => ({schemaVersion:1,pageId:notePageId("page"),blocks:[a,b].map((text,index)=>({id:noteBlockId(`b${index}`),type:"paragraph",props:{},children:[],content:{kind:"inline",items:[{type:"text",text,styles:[]}]}}))});
async function fixture() {
  let server:DocumentSnapshot<NoteDocumentV1>={version:0,saved:doc(),baseline:doc()}, checkpoint:DocumentCheckpoint<NoteDocumentV1>|undefined;
  let held=false;const waiting:(()=>void)[]=[];
  const requests:DocumentCommit<NoteDocumentV1>[]=[];
  const options={adapter,requestId:(n:number)=>`request-${n}`,preservation:{load:()=>checkpoint,save:(value:DocumentCheckpoint<NoteDocumentV1>)=>{checkpoint=value;}},
    port:{read:async()=>server,commit:async(request:DocumentCommit<NoteDocumentV1>)=>{
      requests.push(request);if(held)await new Promise<void>(resolve=>waiting.push(resolve));
      if(request.expectedVersion!==server.version)throw new DocumentVersionConflict(server,request.id);
      server={version:server.version+1,saved:request.saved,baseline:request.baseline};return server;
    }}};
  return {session:await HbsSession.open(options),options,requests,get server(){return server;},get checkpoint(){return checkpoint;},
    external:(saved:NoteDocumentV1)=>{server={...server,version:server.version+1,saved};},hold:()=>{held=true;},release:()=>{held=false;waiting.splice(0).forEach(resolve=>resolve());}};
}
const settle=async()=>{for(let n=0;n<30;n++)await Promise.resolve();};
it("flushes admitted preservation without implicitly saving later unsaved input",async()=>{
  const f=await fixture();f.session.edit(doc("not saved"));await f.session.flushPreservation();
  expect(f.checkpoint?.content).toEqual(doc());
  expect(f.requests).toHaveLength(0);
});
it("explicit preservation saves H without committing S/B or accepting a candidate",async()=>{
  const f=await fixture();f.external(doc("new"));await f.session.syncLatest();
  f.session.edit(doc("edited new"));await f.session.preserve();
  expect(f.requests).toHaveLength(0);expect(f.server.baseline).toEqual(doc());
  expect(f.checkpoint?.content).toEqual(doc("edited new"));f.session.dispose();
  const reopened=await HbsSession.open(f.options);
  expect(reopened.getSnapshot().content).toEqual(doc("edited new"));expect(reopened.getSnapshot().changes).toHaveLength(1);reopened.dispose();
});
it("saves ordinary edits in B but keeps edits inside the pending unit out of B",async()=>{
  const f=await fixture();f.external(doc("new"));await f.session.syncLatest();
  f.session.edit(doc("edited new","edited ordinary"));await f.session.save();
  expect(f.server.saved).toEqual(doc("edited new","edited ordinary"));
  expect(f.server.baseline).toEqual(doc("old","edited ordinary"));
  expect(f.checkpoint?.content).toEqual(f.server.saved);
});
it("retains later input through a held receipt and drains another save",async()=>{
  const f=await fixture();f.hold();f.session.edit(doc("first"));void f.session.save();await settle();
  f.session.edit(doc("second"));void f.session.save();await settle();f.release();await settle();
  expect(f.server.saved).toEqual(doc("second"));expect(f.session.getSnapshot().content).toEqual(doc("second"));expect(f.server.baseline).toEqual(doc("second"));
});
it("keeps a pending action reversible before and after its durable receipt",async()=>{
  const f=await fixture();f.external(doc("new"));await f.session.syncLatest();f.hold();
  const entry=f.session.perform(()=>f.session.resolve(f.session.getSnapshot().changes[0]!.id,"keep"));await settle();
  f.session.restore(entry,"before");f.release();await settle();
  expect(f.server.baseline).toEqual(doc());expect(f.session.getSnapshot().changes).toHaveLength(1);
  f.session.restore(entry,"after");await settle();expect(f.server.baseline).toEqual(doc("new"));
  f.session.restore(entry,"before");await settle();expect(f.server.baseline).toEqual(doc());
});
it("recovers conflicted candidate input and does not turn saving into Keep",async()=>{
  const f=await fixture();f.external(doc("new"));await f.session.syncLatest();f.session.edit(doc("mine"));f.external(doc("incoming"));await f.session.save();
  expect(f.session.getSnapshot().conflicts).toHaveLength(1);f.session.dispose();
  const restored=await HbsSession.open(f.options);expect(restored.getSnapshot().content).toEqual(doc("mine"));
  restored.resolve(restored.getSnapshot().conflicts[0]!.id,"incoming");await restored.save();
  expect(f.server.saved).toEqual(doc("incoming"));expect(f.server.baseline).toEqual(doc());expect(restored.getSnapshot().changes).toHaveLength(1);
});
it("ignores old snapshots and preserves new input when a receipt arrives behind a newer snapshot",async()=>{
  let server:DocumentSnapshot<NoteDocumentV1>={version:0,saved:doc(),baseline:doc()},release:(()=>void)|undefined;
  const session=await HbsSession.open({adapter,requestId:n=>`late-${n}`,preservation:{load:()=>undefined,save:()=>{}},port:{read:async()=>server,commit:async request=>{
    if (request.expectedVersion !== server.version) throw new DocumentVersionConflict(server,request.id);
    const receipt={version:request.expectedVersion+1,saved:request.saved,baseline:request.baseline};server=receipt;
    if (!release) await new Promise<void>(resolve=>{release=resolve;});return receipt;
  }}});
  session.edit(doc("my saved"));void session.save();await settle();
  session.edit(doc("newer typing"));
  server={version:2,saved:doc("my saved","remote ordinary"),baseline:doc("my saved")};session.receive(server);
  release!();await settle();session.receive({version:0,saved:doc(),baseline:doc()});
  expect(session.getSnapshot().observed.version).toBe(3);
  expect(server.baseline).toEqual(doc("newer typing"));
  expect(session.getSnapshot().content).toEqual(doc("newer typing","remote ordinary"));
});
