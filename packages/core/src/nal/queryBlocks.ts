import { validateNalQuery, type NalQuery, type NalQueryBlock, type NalQueryGroup } from "./index";

export function isNalQueryGroup(block:NalQueryBlock):block is NalQueryGroup {
  return "kind" in block && block.kind==="group";
}
/** Flatten only for leaf matching/indexes; evaluation always retains group boundaries. */
export function nalQueryLeaves(blocks:readonly NalQueryBlock[]):readonly NalQuery[] {
  return blocks.flatMap(block=>isNalQueryGroup(block) ? nalQueryLeaves(block.children) : [block]);
}
export function validateNalQueryBlocks(value:unknown,budget={remaining:16000},depth=0):asserts value is readonly NalQueryBlock[] {
  if(!Array.isArray(value) || !value.length || value.length>16 || depth>12)throw new Error("查询分组需要 1–16 个 block，最多嵌套 12 层");
  for(const entry of value){
    if(--budget.remaining<0 || !entry || typeof entry!=="object")throw new Error("查询 block 无效或过大");
    if("kind" in entry && entry.kind==="group"){
      if(entry.connector!=="conjunction" && entry.connector!=="disjunction")throw new Error("分组 connector 无效");
      validateNalQueryBlocks(entry.children,budget,depth+1);
    }else validateNalQuery(entry,0,budget);
  }
  if(nalQueryLeaves(value).length>16)throw new Error("一个查询路径最多 16 个条件");
}
