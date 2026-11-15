import { expect, it } from "vitest";
import { NalInferenceCache, NalQueryCollections, emptyNalState, nalFactKey, decodeNalQueryCache, decodeNalQueryDefinitions, parseNalConditions,
  type NalQueryCollection, type NalState, type NalStatement, type NalTerm } from "./index";
const c=(id:string):NalTerm=>({kind:"concept",id});
const p=(id:string):NalTerm=>({kind:"paper",id});
const pair=(a:NalTerm,b:NalTerm):NalTerm=>({kind:"product",terms:[a,b]});
const s=(id:string,a:NalTerm,b:NalTerm):NalStatement=>({id,subject:a,predicate:b,origin:"human"});
const belongs=(id:string,a:NalTerm,b:NalTerm)=>s(id,pair(a,b),c("belongs"));
const state:NalState={...emptyNalState(),rules:[{id:"transitive:belongs",kind:"transitive",relationConceptId:"belongs"}],statements:[
  belongs("hierarchy",c("DL"),c("AI")), belongs("one",p("1"),c("DL")), belongs("two",p("2"),c("AI")),
  belongs("percept",p("1"),c("perception")),
]};
const q=(id:string)=>({subject:{kind:"product" as const,terms:[{kind:"variable" as const,name:"x"},c(id)]},predicate:c("belongs")});
const definitions:readonly NalQueryCollection[]=[{id:"ai",name:"AI领域",conditions:[q("AI")]},{id:"vision",parentId:"ai",name:"感知领域",conditions:[q("perception")]}];
const active=new Set(["1","2","3"]);
function papers(projection:NalQueryCollections,id="ai"){return new Set(projection.results().find(r=>r.definition.id===id)?.paperIds);}
it("persists materialized hierarchy and reopens with zero joins or fact matching",()=>{
  const views=new NalQueryCollections();views.sync(state,active,definitions);
  expect(papers(views)).toEqual(new Set(["1","2"]));expect(papers(views,"vision")).toEqual(new Set(["1"]));
  const raw=JSON.parse(JSON.stringify(views.export()));
  expect(decodeNalQueryCache(raw)).toBeDefined();
  const restored=new NalQueryCollections(decodeNalQueryCache(raw));
  expect(restored.sync({...state,revision:99,concepts:[{id:"AI",label:"新名称",explanation:"",revision:1}]},active,definitions)).toEqual({joins:0,matchedFacts:0,updatedViews:0});
  expect(papers(restored,"vision")).toEqual(new Set(["1"]));
});
it("adds only delta matches, preserves alternate support, and retracts unsupported descendants",()=>{
  const views=new NalQueryCollections();views.sync(state,active,definitions);
  const direct=belongs("direct",p("1"),c("AI"));
  const added={...state,statements:[...state.statements,direct,belongs("three",p("3"),c("AI"))]};
  const delta=views.sync(added,active,definitions);
  expect(delta.matchedFacts).toBeLessThan(views.export().inference.facts.length*3);
  expect(papers(views)).toEqual(new Set(["1","2","3"]));
  const removed={...added,statements:added.statements.filter(s=>s.id!=="hierarchy")};
  views.sync(removed,active,definitions);
  expect(papers(views,"vision")).toEqual(new Set(["1"]));
  views.sync({...removed,statements:removed.statements.filter(s=>s.id!=="direct")},active,definitions);
  expect(papers(views)).toEqual(new Set(["2","3"]));expect(papers(views,"vision")).toEqual(new Set());
});
it("disabling rules, hiding papers, restoring, and editing ancestors update cached children",()=>{
  const views=new NalQueryCollections();views.sync(state,active,definitions);
  views.sync({...state,rules:[]},active,definitions);expect(papers(views)).toEqual(new Set(["2"]));
  views.sync(state,new Set(["2"]),definitions);expect(papers(views,"vision")).toEqual(new Set());
  views.sync(state,active,definitions);expect(papers(views,"vision")).toEqual(new Set(["1"]));
  views.sync(state,active,[{...definitions[0]!,conditions:[q("DL")]},definitions[1]!]);expect(papers(views)).toEqual(new Set(["1"]));
});
it("conjoins shared variables rather than accepting unrelated witnesses",()=>{
  const views=new NalQueryCollections();
  const next={...state,statements:[belongs("ai",p("1"),c("AI")),belongs("percept",p("2"),c("perception"))]};
  views.sync(next,active,definitions);expect(papers(views,"vision")).toEqual(new Set());
});
it("accepts user Narsese conjunctions while retaining quoted literal punctuation",()=>{
  const vocabulary=["AI","perception","belongs","A && B"].map(id=>({atom:{kind:"concept" as const,id},label:id}));
  const conditions=parseNalConditions('($x * AI) --> belongs && ($x * perception) --> belongs',vocabulary);
  expect(conditions).toEqual([q("AI"),q("perception")]);
  expect(parseNalConditions('($x * "A && B") --> belongs',vocabulary)).toHaveLength(1);
  expect(()=>decodeNalQueryDefinitions([{...definitions[0],parentId:"vision"},definitions[1]])).toThrow("循环");
  expect(decodeNalQueryCache({version:0})).toBeUndefined();
});
it("deletes cyclic support without retaining self-justifying facts",()=>{
  const cache=new NalInferenceCache();
  const a=s("a",c("A"),c("B")),b=s("b",c("B"),c("A")),d=s("d",c("B"),c("D"));
  cache.sync({...state,rules:[],statements:[a,b,d]});
  expect(cache.export().facts.some(f=>nalFactKey(f)===nalFactKey(s("x",c("A"),c("D"))))).toBe(true);
  cache.sync({...state,rules:[],statements:[b,d]});
  expect(cache.export().facts.some(f=>nalFactKey(f)===nalFactKey(s("x",c("A"),c("D"))))).toBe(false);
});
it("matches an independent transitive closure after deterministic mixed additions/deletions",()=>{
  let seed=19;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed;};
  const cache=new NalInferenceCache();let assertions:NalStatement[]=[];
  for(let n=0;n<120;n++){
    const x=`${random()%9}`,y=`${random()%9}`,id=`${x}:${y}`;
    if(random()%3===0)assertions=assertions.filter(s=>s.id!==id);
    else if(x!==y && !assertions.some(s=>s.id===id))assertions=[...assertions,s(id,c(x),c(y))];
    cache.sync({...emptyNalState(),statements:assertions});
    const expected=new Set(assertions.map(nalFactKey));
    let changed=true;
    while(changed){changed=false;for(let a=0;a<9;a++)for(let b=0;b<9;b++)for(let d=0;d<9;d++){
      const key=nalFactKey(s("",c(`${a}`),c(`${d}`)));
      if(a!==d && expected.has(nalFactKey(s("",c(`${a}`),c(`${b}`)))) && expected.has(nalFactKey(s("",c(`${b}`),c(`${d}`)))) && !expected.has(key)){expected.add(key);changed=true;}
    }}
    expect(new Set(cache.export().facts.map(nalFactKey)),`operation ${n}`).toEqual(expected);
    const sourceIds=new Set(assertions.map(s=>s.id));
    expect(cache.export().facts.every(f=>f.statementIds.every(id=>sourceIds.has(id)))).toBe(true);
  }
});
it("retains the last complete projection when inference exceeds the budget",()=>{
  const views=new NalQueryCollections();views.sync(state,active,definitions);
  const before=JSON.stringify(views.export());
  expect(()=>views.sync({...state,statements:Array.from({length:20001},(_,i)=>s(`${i}`,c(`a${i}`),c("AI")))},active,definitions)).toThrow("20000");
  expect(JSON.stringify(views.export())).toBe(before);
});
it("joins thousands of shared paper bindings using an index, not a cartesian scan",()=>{
  const many={...state,statements:Array.from({length:1200},(_,i)=>[belongs(`ai${i}`,p(`${i}`),c("AI")),belongs(`v${i}`,p(`${i}`),c("perception"))]).flat()};
  const views=new NalQueryCollections();views.sync(many,new Set(Array.from({length:1200},(_,i)=>`${i}`)),definitions);
  expect(papers(views,"vision").size).toBe(1200);
});
it("child conditions intersect paper membership even when the variable labels differ",()=>{
  const views=new NalQueryCollections();
  const child={...definitions[1]!,conditions:[{...q("perception"),subject:{kind:"product" as const,terms:[{kind:"variable" as const,name:"文章"},c("perception")]}}]};
  views.sync(state,active,[definitions[0]!,child]);
  expect(papers(views,"vision")).toEqual(new Set(["1"]));
});
it("preserves query punctuation in formatted concept labels",async()=>{
  const {formatNalConditions}=await import("./index");
  const vocabulary=["A && B","$x","a*b","price$index"].map(id=>({atom:{kind:"concept" as const,id},label:id}));
  for(const value of vocabulary){
    const query=[{subject:value.atom,predicate:value.atom}];
    expect(parseNalConditions(formatNalConditions(query,vocabulary),vocabulary)).toEqual(query);
  }
});

it("does not rejoin unaffected cached query collections for an unrelated fact",()=>{
  const views=new NalQueryCollections();views.sync(state,active,definitions);
  const next={...state,statements:[...state.statements,s("unrelated",c("method"),c("category"))]};
  expect(views.sync(next,active,definitions).updatedViews).toBe(0);
  expect(papers(views,"vision")).toEqual(new Set(["1"]));
});
