import { nalAtoms, nalTermKey, validateNalQuery, type NalPattern, type NalQuery, type NalState } from "./index";
import { inferNal } from "./inference";

export interface NalQuerySource extends NalQuery {
  readonly id:string; readonly statementIds:readonly string[]; readonly ruleIds:readonly string[]; readonly derived:boolean;
}
export interface NalMatch {
  readonly statement:NalQuerySource;
  readonly bindings:Readonly<Record<string,NalPattern>>;
  readonly statementIds:readonly string[];
  readonly ruleIds:readonly string[];
  readonly paperIds:readonly string[];
}
type Bindings=Readonly<Record<string,NalPattern>>;

/** Exact structural queries over proved facts and explicitly defined rules. */
export function queryNal(state:NalState,query:NalQuery,activePapers?:ReadonlySet<string>):readonly NalMatch[] {
  validateNalQuery(query);
  return matchNalSources([...inferNal(state,activePapers),...nalRuleSources(state)],query);
}
export function matchNalSources(sources:Iterable<NalQuerySource>,query:NalQuery):readonly NalMatch[] {
  const matches:NalMatch[]=[];
  for(const source of sources){
    matches.push(...matchNalFacts(source,query));
    if(matches.length>20_000)throw new Error("查询匹配结果超过上限，请缩小查询范围");
  }
  return matches;
}
/** Rules are searchable as implication structures; querying never asserts a new rule. */
export function nalRuleSources(state:Pick<NalState,"rules">):readonly NalQuerySource[] {
  return state.rules.map(rule=>{
    const relation={kind:"concept" as const,id:rule.relationConceptId};
    const clause=(a:string,b:string):NalPattern=>({kind:"statement",copula:"inheritance",subject:{kind:"product",terms:[{kind:"variable",name:a},{kind:"variable",name:b}]},predicate:relation});
    return {id:rule.id,copula:"implication",subject:{kind:"conjunction",terms:[clause("y","z"),clause("x","y")]},predicate:clause("x","z"),statementIds:[],ruleIds:[rule.id],derived:false};
  });
}

/** Commutative compounds can yield several distinct variable assignments. */
export function matchNalFacts(statement:NalQuerySource,query:NalQuery):readonly NalMatch[] {
  if((statement.copula ?? "inheritance")!==(query.copula ?? "inheritance"))return [];
  let attempts=0;
  const bounded=(rows:readonly Bindings[]):readonly Bindings[]=>{
    if(rows.length>20_000)throw new Error("查询结构匹配结果超过上限，请缩小查询范围");
    return rows;
  };
  const match=(actual:NalPattern,pattern:NalPattern,bindings:Bindings):readonly Bindings[]=>{
    if(++attempts>200_000)throw new Error("查询结构匹配超过上限，请缩小查询范围");
    if(pattern.kind==="variable"){
      const bound=bindings[pattern.name];
      return bound ? nalTermKey(bound)===nalTermKey(actual) ? [bindings] : [] : [Object.assign(Object.create(null) as Record<string,NalPattern>,bindings,{[pattern.name]:actual})];
    }
    if("terms" in actual || "terms" in pattern){
      if(!("terms" in actual) || !("terms" in pattern) || actual.kind!==pattern.kind || actual.terms.length!==pattern.terms.length)return [];
      if(pattern.kind==="product")return actual.terms.reduce<readonly Bindings[]>((rows,term,i)=>bounded(rows.flatMap(row=>match(term,pattern.terms[i]!,row))),[bindings]);
      const unordered=(index:number,remaining:readonly NalPattern[],row:Bindings):readonly Bindings[]=>{
        if(index===pattern.terms.length)return [row];
        const rows:Bindings[]=[];
        for(let i=0;i<remaining.length;i++){
          // Equal compound components do not create duplicate permutations.
          if(remaining.slice(0,i).some(t=>nalTermKey(t)===nalTermKey(remaining[i]!)))continue;
          for(const next of match(remaining[i]!,pattern.terms[index]!,row)){
            rows.push(...unordered(index+1,remaining.filter((_,n)=>n!==i),next));bounded(rows);
          }
        }
        return rows;
      };
      return unordered(0,actual.terms,bindings);
    }
    if(actual.kind==="statement" || pattern.kind==="statement"){
      if(actual.kind!=="statement" || pattern.kind!=="statement" || (actual.copula ?? "inheritance")!==(pattern.copula ?? "inheritance"))return [];
      return bounded(match(actual.subject,pattern.subject,bindings).flatMap(row=>match(actual.predicate,pattern.predicate,row)));
    }
    return actual.kind!=="variable" && actual.kind===pattern.kind && actual.id===pattern.id ? [bindings] : [];
  };
  const rows=bounded(match(statement.subject,query.subject,Object.create(null) as Bindings).flatMap(row=>match(statement.predicate,query.predicate,row)));
  const unique=new Map(rows.map(row=>[JSON.stringify(Object.keys(row).sort().map(name=>[name,nalTermKey(row[name]!)])),row]));
  const atoms=[...nalAtoms(statement.subject),...nalAtoms(statement.predicate)];
  return [...unique.values()].map(bindings=>{
    const bound=Object.values(bindings).flatMap(nalAtoms).filter(a=>a.kind==="paper");
    const paperIds=[...new Set((bound.length ? bound : atoms.filter(a=>a.kind==="paper")).map(a=>a.id))];
    return {statement,bindings,paperIds,statementIds:statement.statementIds,ruleIds:statement.ruleIds};
  });
}
/** Fact-key caches only need to know whether at least one assignment exists. */
export function matchNalFact(statement:NalQuerySource,query:NalQuery):NalMatch|undefined {
  return matchNalFacts(statement,query)[0];
}
