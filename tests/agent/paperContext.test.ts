import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { decodeAgentPaperContextPreview, decodeAgentPaperContextRequest, type AgentPaperContextPreview } from "../../packages/core/src/agent";
import { createAgentPaperContextGateway } from "../../packages/data/src/agent";

// Rust's actual frozen fixture is compared by the native test too.
type Mutable<T> = T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;
function fixture(): Mutable<AgentPaperContextPreview> { return JSON.parse(readFileSync(new URL("../fixtures/agent-paper-context-v1.json", import.meta.url), "utf8")); }
function request() { const value=fixture(); return {paperId:value.paperId as string,snapshotId:value.snapshotId as string,expectedContextHash:value.contextHash as string}; }

it("decodes the native complete manifest without converting images or instructions into text submissions", () => {
  const input=fixture(), decoded=decodeAgentPaperContextPreview(input,request());
  expect(decoded).toEqual(input);
  expect(decoded.items).toHaveLength(3);
  expect(decoded.items.find(item=>item.kind==="picture")?.imageContentSha256).toBe("b".repeat(64));
  expect(decoded.items.some(item=>item.text?.includes("ignore prior instructions"))).toBe(true);
  const table=decoded.items.find(item=>item.kind==="table")!;
  (input.items.find(item=>item.kind==="table")!.tableJson as {table_cells:{text:string}[]}).table_cells[0]!.text="changed";
  input.items[0]!.regions[0]!.rect.width=0.99;
  expect(table.tableJson).toEqual({table_cells:[{text:"42"}]});
  expect(decoded.items[0]?.regions[0]?.rect.width).toBe(0.5);
});

it("retains a missing picture hash as null and never drops the picture", () => {
  const input=fixture();input.items.find(item=>item.kind==="picture")!.imageContentSha256=null;
  const value=decodeAgentPaperContextPreview(input,request());
  expect(value.items.find(item=>item.kind==="picture")?.imageContentSha256).toBeNull();
  expect(value.items).toHaveLength(3);
});

it("rejects foreign identities, authority fields, unknown versions and inconsistent attachment provenance", () => {
  for (const mutate of [
    (value:ReturnType<typeof fixture>)=>{value.paperId="foreign";},
    (value:ReturnType<typeof fixture>)=>{value.snapshotId="paper-context-"+"f".repeat(64);},
    (value:ReturnType<typeof fixture>)=>{value.contextHash="f".repeat(64);},
    (value:ReturnType<typeof fixture>)=>{Object.assign(value,{schemaVersion:2});},
    (value:ReturnType<typeof fixture>)=>{Object.assign(value,{grant:true});},
    (value:ReturnType<typeof fixture>)=>{Object.assign(value.items[0]!,{instruction:true});},
    (value:ReturnType<typeof fixture>)=>{value.items[0]!.parseRunId="different-parse";},
    (value:ReturnType<typeof fixture>)=>{value.items[0]!.contentSha256="f".repeat(64);},
    (value:ReturnType<typeof fixture>)=>{Object.assign(value.items[0]!,{kind:"instruction"});},
    (value:ReturnType<typeof fixture>)=>{Object.assign(value.items[0]!,{kind:["text"]});},
    (value:ReturnType<typeof fixture>)=>{value.items[0]!.sourceId=value.items[1]!.sourceId;},
    (value:ReturnType<typeof fixture>)=>{value.items[0]!.id=value.items[1]!.id;},
    (value:ReturnType<typeof fixture>)=>{value.attachments=[];},
    (value:ReturnType<typeof fixture>)=>{value.attachments[0]!.ordinal=1;},
  ]) {const value=fixture();mutate(value);expect(()=>decodeAgentPaperContextPreview(value,request())).toThrow();}
});

it("rejects bad geometry, spans and excessive data instead of clipping or truncating", () => {
  for (const change of [
    {pageIndex:-1}, {pageIndex:2**32}, {charspan:[9,1]}, {charspan:[0,1,2]},
    {regions:[{pageIndex:0,rect:{x:0.9,y:0,width:0.2,height:1}}]},
    {regions:[{pageIndex:0,rect:{x:0,y:0,width:0,height:1}}]},
    {text:"x".repeat(8*1024*1024+1)}, {imageContentSha256:"bad"},
  ]) {const value=fixture();Object.assign(value.items[0],change);expect(()=>decodeAgentPaperContextPreview(value,request())).toThrow();}
  expect(()=>decodeAgentPaperContextRequest({...request(),path:"/arbitrary"})).toThrow();
  expect(()=>decodeAgentPaperContextRequest({...request(),snapshotId:"../snapshot"})).toThrow();
});

it("gateway holds original request identity through caller and transport mutation and checks the returned snapshot", async () => {
  let finish!:(value:unknown)=>void;
  const invoke=vi.fn((_command:string,args:Record<string,unknown>)=>{
    (args.request as {paperId:string}).paperId="transport-change";
    return new Promise<unknown>(resolve=>{finish=resolve;});
  });
  const gateway=createAgentPaperContextGateway(invoke), selected=request();
  const pending=gateway.preview(selected);selected.paperId="caller-change";
  finish(fixture());expect((await pending).paperId).toBe("paper");
  expect(invoke).toHaveBeenCalledOnce();expect(invoke.mock.calls[0]?.[0]).toBe("agent_preview_paper_context");
  const foreign=fixture();foreign.paperId="other";
  await expect(createAgentPaperContextGateway(vi.fn().mockResolvedValue(foreign)).preview(request())).rejects.toThrow();
});
