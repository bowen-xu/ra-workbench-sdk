import type {NoteBlockV1,NoteDocumentV1} from "./document";
import {isPageEntry,type PageEntryProofs} from "./pageEntries";

/** Only the removed entrance and stable sibling identities are retained. Never
 * replay a whole source document over edits made after the deletion. */
export interface PageEntryRemoval {
  readonly block:NoteBlockV1;
  readonly children?:readonly PageEntryChildIdentity[];
  readonly parentId?:string;
  readonly previousId?:string;
  readonly nextId?:string;
  readonly index:number;
}
export interface PageEntryChildIdentity {readonly id:string;readonly children:readonly PageEntryChildIdentity[]}
const childIdentities=(blocks:readonly NoteBlockV1[]):readonly PageEntryChildIdentity[]=>blocks.map(block=>({id:block.id,children:childIdentities(block.children)}));
export function capturePageEntries(document:NoteDocumentV1,targets:ReadonlySet<string>,proofs?:PageEntryProofs):readonly PageEntryRemoval[] {
  const result:PageEntryRemoval[]=[];
  const visit=(blocks:readonly NoteBlockV1[],parentId?:string)=>blocks.forEach((block,index)=>{
    if(block.type!=="childPage"&&isPageEntry(block,proofs)&&block.content.kind==="reference"&&targets.has(block.content.targetId))
      result.push({block:{...block,children:[]},children:childIdentities(block.children),index,...(parentId?{parentId}:{}),...(blocks[index-1]?{previousId:blocks[index-1]!.id}:{}),...(blocks[index+1]?{nextId:blocks[index+1]!.id}:{})});
    visit(block.children,block.id);
  });
  visit(document.blocks);return result;
}
export function restorePageEntries(document:NoteDocumentV1,removals:readonly PageEntryRemoval[]):NoteDocumentV1 {
  let blocks=document.blocks;
  const removedIds=new Set<string>(removals.map(entry=>entry.block.id));
  const promotedIds=(children:readonly PageEntryChildIdentity[]):readonly string[]=>children.flatMap(block=>removedIds.has(block.id)?promotedIds(block.children):[block.id]);
  // Outer entries first; children can then find their original owner again.
  for(const removal of removals){
    let found=false;
    const visit=(siblings:readonly NoteBlockV1[],parentId?:string):readonly NoteBlockV1[]=>{
      if(parentId!==removal.parentId)return siblings.map(block=>({...block,children:visit(block.children,block.id)}));
      found=true;
      if(siblings.some(block=>block.id===removal.block.id))throw new Error("note_entry_history_changed: 页面入口已存在，请核对当前笔记。");
      const childIds=new Set(promotedIds(removal.children??childIdentities(removal.block.children)));
      const children=siblings.filter(block=>childIds.has(block.id));
      const next=siblings.filter(block=>!childIds.has(block.id));
      const after=next.findIndex(block=>block.id===removal.nextId),before=next.findIndex(block=>block.id===removal.previousId);
      const index=after>=0?after:before>=0?before+1:Math.min(removal.index,next.length);
      next.splice(index,0,{...removal.block,children});return next;
    };
    blocks=visit(blocks);
    if(!found)throw new Error("note_entry_history_changed: 页面入口的原位置已不存在，请核对当前笔记。");
  }
  return {...document,blocks};
}
