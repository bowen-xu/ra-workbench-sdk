import {expect,it} from "vitest";
import {capturePageEntries,restorePageEntries} from "./pageEntryHistory";
import {removePageEntries} from "./pageEntries";
import {noteBlockId,notePageId,type NoteBlockV1,type NoteDocumentV1} from "./index";
it("restores multiple nested entrances around their promoted and subsequently edited children",()=>{
  const leaf:NoteBlockV1={id:noteBlockId("text"),type:"paragraph",props:{},children:[],content:{kind:"inline",items:[{type:"text",text:"before",styles:[]}]}};
  const entry=(id:string,children:readonly NoteBlockV1[]):NoteBlockV1=>({id:noteBlockId(id),type:"researchObjectReference",props:{pageEntry:true},children,content:{kind:"reference",targetKind:"note_page",targetId:id,labelSnapshot:id,quoteSnapshot:""}});
  const document:NoteDocumentV1={schemaVersion:1,pageId:notePageId("parent"),blocks:[entry("outer",[entry("inner",[leaf])])]};
  const targets=new Set(["outer","inner"]),entries=capturePageEntries(document,targets),removed=removePageEntries(document,targets);
  const edited={...removed,blocks:[{...leaf,content:{kind:"inline" as const,items:[{type:"text" as const,text:"after",styles:[]}]}}]};
  const restored=restorePageEntries(edited,entries);
  expect(restored.blocks[0]?.children[0]?.children[0]?.content).toEqual(edited.blocks[0]!.content);
});
