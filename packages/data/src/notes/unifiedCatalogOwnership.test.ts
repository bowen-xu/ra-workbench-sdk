import {expect,it} from "vitest";
import {harness,query} from "./unifiedCatalog.fixture";
import {NotesGatewayError} from "./errors";

it.each(["pages","writing"] as const)("rejects changed %s generation before using cached tails",async source => {
  const h = harness(), first = await h.catalog.query(query);
  if (source === "pages") h.changePages(); else h.changeWriting();
  await expect(h.catalog.query({...query,cursor:first.nextCursor!})).rejects.toMatchObject({code:"revision_conflict",message:expect.stringContaining("catalog_changed")});
});

it("does not publish a mixed first page when the other source changes during the initial reads",async () => {
  const h = harness(), original = h.queryWriting.getMockImplementation()!;
  h.queryWriting.mockImplementation(async q=>{const page=await original(q); if(q.limit===20) h.changePages(); return page;});
  await expect(h.catalog.query(query)).rejects.toThrow("catalog_changed");
});

it("rejects source version changes when the next page refills after the checkpoint",async () => {
  const h = harness(100), first = await h.catalog.query(query), original = h.queryPages.getMockImplementation()!;
  h.queryPages.mockImplementation(async q=>{if (q.cursor) h.changePages(); return original(q);});
  let cursor = first.nextCursor!;
  await expect((async()=>{for(let index=0;index<5;index++) cursor=(await h.catalog.query({...query,cursor})).nextCursor!;})()).rejects.toThrow("catalog_changed");
});

it("propagates actionable source errors without enumerating files or falling back to memory search",async () => {
  const h = harness(), failure = new NotesGatewayError("database_busy","note_database_busy: operation=fixture-7 HTTP 503");
  h.queryWriting.mockRejectedValue(failure);
  await expect(h.catalog.query(query)).rejects.toBe(failure);
  expect(h.queryPages).toHaveBeenCalledTimes(1); expect(h.queryWriting).toHaveBeenCalledTimes(1);
});

it("rejects a body-bearing source response before retaining it",async () => {
  const h = harness(), original = h.queryPages.getMockImplementation()!;
  h.queryPages.mockImplementation(async q=>{const page=await original(q); return {...page,items:page.items.map(item=>({...item,document:{blocks:[]}}))};});
  await expect(h.catalog.query(query)).rejects.toThrow("response_invalid");
});

it("cancellation stops follow-up checkpoints and never publishes cursor positions",async () => {
  const h = harness(), controller = new AbortController(), original = h.queryPages.getMockImplementation()!;
  h.queryPages.mockImplementation(async q=>{const page=await original(q); controller.abort(); return page;});
  await expect(h.catalog.query(query,{signal:controller.signal})).rejects.toMatchObject({name:"AbortError"});
  expect(h.queryPages).toHaveBeenCalledTimes(1); expect(h.queryWriting).toHaveBeenCalledTimes(1);
});

it("clearing an owner invalidates an already dispatched query",async () => {
  const h = harness(), original = h.queryPages.getMockImplementation()!;
  h.queryPages.mockImplementation(async q=>{const page=await original(q); h.catalog.clear(); return page;});
  await expect(h.catalog.query(query)).rejects.toThrow("cursor_expired"); expect(h.queryPages).toHaveBeenCalledTimes(1);
});

it("rejects a nonadvancing adapter cursor without looping or hiding the failure",async () => {
  const h = harness(100), original = h.queryPages.getMockImplementation()!;
  h.queryPages.mockImplementation(async q=>{const page=await original(q);return q.cursor ? {...page,nextCursor:q.cursor} : page;});
  let result = await h.catalog.query(query);
  await expect((async()=>{for(let i=0;i<5;i++) result=await h.catalog.query({...query,cursor:result.nextCursor!});})()).rejects.toThrow("cursor_stalled");
});

it("uses lazy shared collation only for a genuine two-source non-date comparison",async () => {
  const h = harness(); await h.catalog.query({...query,sort:{field:"title",direction:"ascending"}});
  expect(h.loadRuntime).toHaveBeenCalledTimes(1);
  h.loadRuntime.mockClear(); await h.catalog.query({...query,category:"independent",sort:{field:"title",direction:"ascending"}});
  expect(h.loadRuntime).not.toHaveBeenCalled();
});

it("does not accept a mismatched collation runtime",async () => {
  const h = harness(), original = h.loadRuntime.getMockImplementation()!;
  h.loadRuntime.mockImplementation(async()=>({...await original(),collationVersion:"obsolete"}));
  await expect(h.catalog.query({...query,sort:{field:"source",direction:"descending"}})).rejects.toThrow("collation_mismatch");
});

it.each([null,{}, {limit:0},{limit:201},{limit:1.5},{search:undefined},{category:"other"},{view:"unknown"},{sort:{field:"body",direction:"ascending"}},{cursor:"x".repeat(257)}])("validates untrusted input %j before dispatch",async partial => {
  const h = harness(), value = partial === null ? null : Object.keys(partial).length ? {...query,...partial} : {};
  await expect(h.catalog.query(value as never)).rejects.toMatchObject({code:"invalid_input"});
  expect(h.queryPages).not.toHaveBeenCalled(); expect(h.queryWriting).not.toHaveBeenCalled(); expect(h.loadRuntime).not.toHaveBeenCalled();
});

it("returns a source's malformed continuation as a stable response failure",async () => {
  const h=harness();h.queryWriting.mockResolvedValue({items:[],revision:1,pendingCount:0,errorCount:0,issues:[],nextCursor:"x".repeat(9000)});
  await expect(h.catalog.query(query)).rejects.toThrow("response_invalid");
});

it("does not dispatch any call for an already aborted request",async () => {
  const h=harness(), controller=new AbortController();controller.abort();
  await expect(h.catalog.query(query,{signal:controller.signal})).rejects.toMatchObject({name:"AbortError"});
  expect(h.queryPages).not.toHaveBeenCalled(); expect(h.queryWriting).not.toHaveBeenCalled();
});

it("passes the owner signal into canonical page preparation",async () => {
  const h=harness(), controller=new AbortController();
  await h.catalog.query(query,{signal:controller.signal});
  expect(h.queryPages).toHaveBeenCalledWith(expect.objectContaining({limit:20}),{signal:controller.signal});
});
