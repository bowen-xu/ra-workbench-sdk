import type {NoteBlockV1,NoteDocumentV1} from "./document";

/** A creation receipt proves an older auto-inserted entry's exact block identity.
 * Ordinary page links and inline mentions never become owned entries by title. */
export type PageEntryProofs=ReadonlyMap<string,string>;
export function isPageEntry(block:NoteBlockV1,proofs?:PageEntryProofs):boolean {
  return block.content.kind==="reference" && block.content.targetKind==="note_page"
    && (block.type==="childPage" || block.type==="researchObjectReference"&&block.props.pageEntry===true || proofs?.get(block.id)===block.content.targetId);
}
/** Page entrances carry lifecycle; ordinary page links and @ mentions do not. */
export function pageEntryTargets(document:NoteDocumentV1):ReadonlySet<string> {
  const targets=new Set<string>();
  const visit=(blocks:readonly NoteBlockV1[])=>{for(const block of blocks){
    if(isPageEntry(block)&&block.content.kind==="reference")targets.add(block.content.targetId);
    visit(block.children);
  }};
  visit(document.blocks);return targets;
}
export function removePageEntries(document:NoteDocumentV1,targets:ReadonlySet<string>,proofs?:PageEntryProofs):NoteDocumentV1 {
  const visit=(blocks:readonly NoteBlockV1[]):readonly NoteBlockV1[]=>blocks.flatMap(block=>{
    const children=visit(block.children);
    // Removing an entrance must preserve the unrelated text nested under it.
    return block.content.kind==="reference" && targets.has(block.content.targetId) && isPageEntry(block,proofs)
      ? children : [{...block,children}];
  });
  return {...document,blocks:visit(document.blocks)};
}
/** Apply only explicit legacy-entry lifecycle changes to B. Pending body and
 * ordinary references retain their own HBS review state. Legacy entries are roots. */
export function synchronizeLegacyPageEntries(baseline:NoteDocumentV1,current:NoteDocumentV1,targets:ReadonlySet<string>):NoteDocumentV1 {
  const owned=(block:NoteBlockV1)=>block.type==="childPage" && block.content.kind==="reference" && targets.has(block.content.targetId);
  const blocks=baseline.blocks.filter(block=>!owned(block));
  current.blocks.forEach((block,index)=>{
    if(!owned(block))return;
    const next=current.blocks.slice(index+1).find(candidate=>blocks.some(item=>item.id===candidate.id));
    const previous=current.blocks.slice(0,index).reverse().find(candidate=>blocks.some(item=>item.id===candidate.id));
    const at=next ? blocks.findIndex(item=>item.id===next.id) : previous ? blocks.findIndex(item=>item.id===previous.id)+1 : Math.min(index,blocks.length);
    blocks.splice(at,0,block);
  });
  return {...baseline,blocks};
}
export function pageEntryProofs(document:NoteDocumentV1,target:string):ReadonlyMap<string,string> {
  const result=new Map<string,string>();
  const visit=(blocks:readonly NoteBlockV1[])=>{for(const block of blocks){
    if(block.content.kind==="reference" && block.content.targetKind==="note_page" && block.content.targetId===target)result.set(block.id,target);
    visit(block.children);
  }};
  visit(document.blocks);return result;
}
