import {expect,it,vi} from "vitest";
import {queryNoteIndex,type NoteIndexRecord,notePageId} from "@research-assistant/core/notes";
import type {NotePageCatalogQuery} from "./catalog";
import {queryNoteTargetCatalog} from "./targetsCatalog";
import {NotesGatewayError} from "./errors";

function fixture(active=23,archived=3){
  const records:NoteIndexRecord[]=Array.from({length:active+archived},(_,index)=>({id:`page:${index}`,title:`Note ${index}`,snippet:"",category:"independent",status:index<active?"active":"archived",isFavorite:false,updatedAt:new Date(Date.UTC(2026,9,24)-index*1000).toISOString(),target:{kind:"page",pageId:notePageId(String(index))},searchText:`body needle ${index}`}));
  let revision=1;
  const query=vi.fn(async(q:NotePageCatalogQuery)=>({...queryNoteIndex(records,{...q,search:q.search??""}),revision}));
  return{gateway:{queryNotePageCatalog:query},query,change:()=>revision++};
}
it("pages active then archived identities without fetching documents or dropping a short tail",async()=>{
  const f=fixture(),first=await queryNoteTargetCatalog(f.gateway,"");expect(first.items).toHaveLength(20);
  const second=await queryNoteTargetCatalog(f.gateway,"",first.nextCursor);expect(second.items).toHaveLength(6);expect(second.nextCursor).toBeUndefined();
  expect(new Set([...first.items,...second.items].map(item=>item.id)).size).toBe(26);
  expect(f.query.mock.calls.map(([q])=>[q.view,q.limit])).toEqual([["recent",20],["recent",1],["recent",20],["archive",17],["recent",1]]);
});
it("begins with archived candidates when no active candidate exists",async()=>{
  const f=fixture(0,40),first=await queryNoteTargetCatalog(f.gateway,"");expect(first.items).toHaveLength(20);expect(first.items.every(item=>item.status==="archived")).toBe(true);
  expect(f.query.mock.calls.every(([q])=>(q.limit??0)<=20)).toBe(true);
});
it("searches the persistent live projection once and uses a metadata-only checkpoint",async()=>{
  const f=fixture(1,1),page=await queryNoteTargetCatalog(f.gateway,"needle");expect(page.items).toHaveLength(2);
  expect(f.query.mock.calls.map(([q])=>q.search??"")).toEqual(["needle",""]);
});
it("binds a continuation to its original query before dispatching it",async()=>{
  const f=fixture(30,0),page=await queryNoteTargetCatalog(f.gateway,"");f.query.mockClear();
  await expect(queryNoteTargetCatalog(f.gateway,"different",page.nextCursor)).rejects.toThrow("cursor_invalid");expect(f.query).not.toHaveBeenCalled();
});
it("rejects changed generations rather than mixing an archived tail with older active results",async()=>{
  const f=fixture(23,3),first=await queryNoteTargetCatalog(f.gateway,"");f.change();
  await expect(queryNoteTargetCatalog(f.gateway,"",first.nextCursor)).rejects.toMatchObject({code:"revision_conflict",currentRevision:2});
});
it("keeps source diagnostics and refuses body-bearing or nonadvancing responses",async()=>{
  const f=fixture();f.query.mockRejectedValueOnce(new NotesGatewayError("database_busy","operation=source-9"));await expect(queryNoteTargetCatalog(f.gateway,"")).rejects.toThrow("source-9");
  f.query.mockResolvedValueOnce({items:[],revision:1,document:{blocks:[]}}as never);await expect(queryNoteTargetCatalog(f.gateway,"")).rejects.toThrow("response_invalid");
  f.query.mockResolvedValueOnce({items:[],revision:1,nextCursor:"stuck"});await expect(queryNoteTargetCatalog(f.gateway,"")).rejects.toThrow("cursor_stalled");
});
