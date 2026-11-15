import { isNalQueryGroup, nalAtoms, nalTermKey, type NalPattern, type NalQueryBlock } from "./index";
import { nalFactKey } from "./inference";
import type { NalMatch } from "./query";

interface Row {
  readonly bindings:Readonly<Record<string,NalPattern>>;
  readonly papers:ReadonlySet<string>|undefined;
  readonly evidence:ReadonlySet<string>;
}
const identity:Row={bindings:Object.create(null) as Record<string,NalPattern>,papers:undefined,evidence:new Set()};
const limit=(rows:readonly Row[])=>{if(rows.length>20_000)throw new Error("查询结果超过上限，请缩小查询范围");};

/** AND is a compatible natural join; OR retains branch-local bindings until final projection. */
export function evaluateNalGroups(blocks:readonly NalQueryBlock[],clauses:readonly (readonly NalMatch[])[],outputs?:readonly string[]) {
  let at=0,attempts=0;
  const legacy=outputs===undefined;
  const join=(left:readonly Row[],right:readonly Row[]):readonly Row[]=>{
    const next:Row[]=[];
    // OR branches can expose different variable sets. Index each shape separately.
    const shapes=new Map<string,Row[]>();
    for(const row of right){const shape=JSON.stringify(Object.keys(row.bindings).sort()),bucket=shapes.get(shape) ?? [];bucket.push(row);shapes.set(shape,bucket);}
    const indexes=new Map<string,Map<string,Row[]>>();
    for(const row of left)for(const [shape,values] of shapes){
      const shared=(JSON.parse(shape) as string[]).filter(name=>Object.hasOwn(row.bindings,name));
      const signature=JSON.stringify([shape,shared]);
      const key=(b:Row["bindings"])=>JSON.stringify(shared.map(name=>nalTermKey(b[name]!)));
      let index=indexes.get(signature);
      if(!index){index=new Map();for(const value of values){const k=key(value.bindings),bucket=index.get(k) ?? [];bucket.push(value);index.set(k,bucket);}indexes.set(signature,index);}
      for(const other of index.get(key(row.bindings)) ?? []){
        if(++attempts>200_000)throw new Error("多条件查询计算量超过上限，请缩小查询范围");
        const papers=!legacy ? undefined : !other.papers ? row.papers : !row.papers ? other.papers : new Set([...row.papers].filter(id=>other.papers?.has(id)));
        if(papers && !papers.size)continue;
        next.push({bindings:Object.assign(Object.create(null) as Record<string,NalPattern>,row.bindings,other.bindings),papers,evidence:new Set([...row.evidence,...other.evidence])});limit(next);
      }
    }
    return next;
  };
  const evaluate=(block:NalQueryBlock):readonly Row[]=>{
    if(!isNalQueryGroup(block))return (clauses[at++] ?? []).map(match=>({bindings:match.bindings,papers:match.paperIds.length ? new Set(match.paperIds) : undefined,evidence:new Set([nalFactKey(match.statement)])}));
    const branches=block.children.map(evaluate);
    if(block.connector==="disjunction"){
      const rows:Row[]=[];for(const branch of branches){rows.push(...branch);limit(rows);}return rows;
    }
    return branches.sort((a,b)=>a.length-b.length).reduce<readonly Row[]>((rows,branch)=>join(rows,branch),[identity]);
  };
  const branches=blocks.map(evaluate);
  const rows=branches.sort((a,b)=>a.length-b.length).reduce<readonly Row[]>((rows,branch)=>join(rows,branch),[identity]);
  const bindings=rows.map(row=>outputs ? Object.fromEntries(outputs.flatMap(name=>Object.hasOwn(row.bindings,name) ? [[name,row.bindings[name]!]] : [])) : row.bindings);
  const paperIds=outputs ? bindings.flatMap(binding=>Object.values(binding).flatMap(nalAtoms).filter(a=>a.kind==="paper").map(a=>a.id)) : rows.flatMap(row=>[...(row.papers ?? [])]);
  const unique=new Map(bindings.map(binding=>[JSON.stringify(Object.keys(binding).sort().map(name=>[name,nalTermKey(binding[name]!)])),binding]));
  return {paperIds:[...new Set(paperIds)],bindings:[...unique.values()],evidenceKeys:[...new Set(rows.flatMap(row=>[...row.evidence]))]};
}
