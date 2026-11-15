import {expect, it} from "vitest";
import {decodeNotePageCatalogPage} from "./catalog";

const item = () => ({id:"page:note", title:"标题", snippet:"",category:"independent",updatedAt:"2026-10-23T00:00:00Z",status:"active",isFavorite:false,target:{kind:"page",pageId:"note"}});
it("decodes bounded catalog headers and reading aliases without editable content", () => {
  const value = {revision:4,items:[item(),{...item(),id:"page:reading",category:"dependent",owner:{kind:"highlight",id:"source",label:"Paper"},target:{kind:"reading",pageId:"reading",noteId:"source"}}],nextCursor:"opaque"};
  expect(decodeNotePageCatalogPage(value,20)).toEqual(value);
});
it.each([
  {revision:-1,items:[]},{revision:1,items:[{...item(),id:"another"}]},
  {revision:1,items:[{...item(),document:{blocks:[]}}]},
  {revision:1,items:[{...item(),category:"dependent"}]},
  {revision:1,items:[{...item(),target:{kind:"writing",manuscriptId:"x",path:"main.tex"}}]},
  {revision:1,items:[item(),item()]},{revision:1,items:[],nextCursor:""},
])("rejects malformed, cross-source or duplicate catalog replies", value => {
  expect(()=>decodeNotePageCatalogPage(value,20)).toThrow("note_catalog_response_invalid");
});
it("rejects over-limit responses rather than clipping a mismatched page", () => {
  expect(()=>decodeNotePageCatalogPage({revision:1,items:[item()]},0)).toThrow("note_catalog_response_invalid");
});
it("accepts bounded derived search snippets but rejects an accidental full body",()=>{
  expect(decodeNotePageCatalogPage({revision:1,items:[{...item(),snippet:"命中的正文片段"}]}).items[0]?.snippet).toBe("命中的正文片段");
  expect(()=>decodeNotePageCatalogPage({revision:1,items:[{...item(),snippet:"x".repeat(481)}]})).toThrow("note_catalog_response_invalid");
});
