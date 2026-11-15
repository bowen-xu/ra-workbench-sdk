import type {NoteIndexItem} from "@research-assistant/core/notes";
import {decodeNotePageCatalogPage,type NotePageCatalogGateway} from "./catalog";
import {NotesGatewayError} from "./errors";

export interface NoteTargetCatalogPage {readonly items:readonly NoteIndexItem[];readonly nextCursor?:string}
export type NoteTargetQuery=(search:string,cursor?:string)=>Promise<NoteTargetCatalogPage>;
interface TargetCursor {readonly schema:1;readonly scope:string;readonly revision:number;readonly view:"recent"|"archive";readonly source?:string}
const invalid=()=>new NotesGatewayError("invalid_input","note_target_cursor_invalid：笔记候选位置无效，请重新查询。");

/** Link/mention candidates are metadata pages, never a full editable inventory.
 * Empty browsing visits active then archived pages; typed search uses the
 * source's persistent live search. A cursor cannot change its query or source. */
export async function queryNoteTargetCatalog(gateway:NotePageCatalogGateway,search:string,cursor?:string):Promise<NoteTargetCatalogPage>{
  if(typeof search!=="string")throw new NotesGatewayError("invalid_input","note_target_query_invalid：笔记候选查询无效。");
  const normalized=search.trim();
  if(new TextEncoder().encode(normalized).length>4096)throw new NotesGatewayError("invalid_input","note_target_query_too_long：笔记候选查询过长。");
  const scope=normalized?[...new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(normalized)))].map(value=>value.toString(16).padStart(2,"0")).join(""):"";
  let position:TargetCursor|undefined;
  if(cursor!==undefined){
    if(typeof cursor!=="string"||cursor.length>20_000)throw invalid();
    try{position=JSON.parse(cursor)as TargetCursor;}catch{throw invalid();}
    if(!position||typeof position!=="object"||Object.keys(position).some(key=>!["schema","scope","revision","view","source"].includes(key))||position.schema!==1||position.scope!==scope
      ||!Number.isSafeInteger(position.revision)||position.revision<0||!["recent","archive"].includes(position.view)||normalized&&position.view!=="recent"
      ||position.source!==undefined&&(typeof position.source!=="string"||!position.source||position.source.length>8192))throw invalid();
  }
  const items:NoteIndexItem[]=[];let view=position?.view??"recent",source=position?.source,revision=position?.revision,next:TargetCursor|undefined;
  do{
    const limit=20-items.length;
    const page=decodeNotePageCatalogPage(await gateway.queryNotePageCatalog({category:"all",view,search:normalized,limit,...(source?{cursor:source}:{})}),limit);
    revision??=page.revision;
    if(page.revision!==revision)throw new NotesGatewayError("revision_conflict","note_catalog_changed：笔记候选已更新，请重新查询。",page.revision);
    if(page.nextCursor&&(!page.items.length||page.nextCursor===source))throw new NotesGatewayError("index_failed","note_target_cursor_stalled：笔记候选游标未前进。");
    items.push(...page.items);
    if(page.nextCursor){next={schema:1,scope,revision,view,source:page.nextCursor};break;}
    if(normalized||view==="archive")break;
    view="archive";source=undefined;
    if(items.length===20){next={schema:1,scope,revision,view};break;}
  }while(items.length<20);
  const checkpoint=decodeNotePageCatalogPage(await gateway.queryNotePageCatalog({category:"all",view:"recent",limit:1}),1);
  if(checkpoint.revision!==revision)throw new NotesGatewayError("revision_conflict","note_catalog_changed：笔记候选已更新，请重新查询。",checkpoint.revision);
  return{items,...(next?{nextCursor:JSON.stringify(next)}:{})};
}
