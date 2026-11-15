import {expect,it} from "vitest";
import {decodeWritingNoteCatalogPage,decodeWritingNoteCatalogPreparation} from "./writingCatalog";
import {decodeNotePageCatalogPage} from "./catalog";
const item = () => ({id:'writing:["project","note"]',title:"笔记",snippet:"",category:"dependent",owner:{kind:"manuscript",id:"project",label:"项目"},updatedAt:"2026-10-24T00:00:00Z",status:"active",isFavorite:false,target:{kind:"writing",manuscriptId:"project",path:"notes/笔记.ranote"}});
const page = () => ({items:[item()],revision:4,pendingCount:0,errorCount:0,issues:[]});
it("decodes a bounded writing source with independent readiness, without accepting authoring data", () => {
  expect(decodeWritingNoteCatalogPage(page())).toEqual(page());
  const value = {...page(),pendingCount:8,errorCount:1,issues:[{manuscriptId:"project",path:"bad.ranote",cause:"writing_note_json_invalid：JSON无效"}]};
  expect(decodeWritingNoteCatalogPage(value)).toEqual(value);
  expect(()=>decodeNotePageCatalogPage({items:[item()],revision:4})).toThrow("note_catalog_response_invalid");
});
it.each([
  {...page(),documents:{}}, {...page(),pendingCount:-1}, {...page(),revision:NaN},
  {...page(),errorCount:1}, {...page(),issues:[{manuscriptId:"p",path:"p.ranote",cause:"cause"}]},
  {...page(),items:[{...item(),id:'writing:["another","note"]'}]},
  {...page(),items:[{...item(),owner:{kind:"manuscript",id:"another",label:"项目"}}]},
  {...page(),items:[{...item(),document:{blocks:[]}}]},
  {...page(),items:[{...item(),target:{kind:"page",pageId:"note"}}]},
  {...page(),items:[{...item(),isFavorite:true}]}, {...page(),items:[{...item(),status:"trashed"}]},
  {...page(),items:[item(),item()]}, {...page(),nextCursor:""},
])("rejects malformed readiness and cross-source identities", value => {
  expect(()=>decodeWritingNoteCatalogPage(value)).toThrow("writing_note_catalog_response_invalid");
});
it.each(["/notes/a.ranote","../a.ranote","notes/../a.ranote","notes//a.ranote","C:\\a.ranote","notes/a.tex","notes/\0a.ranote"])("rejects an invalid logical writing target: %s", path => {
  expect(()=>decodeWritingNoteCatalogPage({...page(),items:[{...item(),target:{...item().target,path}}]})).toThrow("writing_note_catalog_response_invalid");
});

it.each([
  {processedCount:9,pendingCount:0,errorCount:0}, {processedCount:0,pendingCount:-1,errorCount:0},
  {processedCount:0,pendingCount:0,errorCount:0,body:"private"}, {processedCount:0,pendingCount:0},
])("rejects malformed or over-budget preparation receipts",value=>{
  expect(()=>decodeWritingNoteCatalogPreparation(value)).toThrow("writing_note_catalog_preparation_invalid");
});
it("keeps Unicode note identities separate from logical project paths",()=>{
  const noteId='思路"😀\n';
  const value={...item(),id:`writing:${JSON.stringify(["project",noteId])}`,target:{...item().target,path:"notes/topic:ideas.ranote"}};
  expect(decodeWritingNoteCatalogPage({...page(),items:[value]}).items[0]).toEqual(value);
});
