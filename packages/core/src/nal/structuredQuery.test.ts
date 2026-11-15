import { expect,it } from "vitest";
import { emptyNalState, NalQueryCollections, decodeNalQueryCache, decodeNalQueryDefinitions, nalQueryVariables, queryNal, type NalPattern, type NalQuery } from "./index";
const c=(id:string):NalPattern=>({kind:"concept",id}),v=(name:string):NalPattern=>({kind:"variable",name});
const statement=(subject:NalPattern,predicate:NalPattern):NalPattern=>({kind:"statement",copula:"inheritance",subject,predicate});
const state={...emptyNalState(),rules:[{id:"r",kind:"transitive" as const,relationConceptId:"belongs"}],statements:[
  {id:"s1",origin:"human" as const,subject:{kind:"product" as const,terms:[{kind:"paper" as const,id:"p1"},{kind:"paper" as const,id:"p2"}]},predicate:{kind:"concept" as const,id:"follows"}},
]};
it("preserves recursive connectors and copulas and rejects unfinished or unknown structures",()=>{
  const nested: NalQuery={copula:"implication",subject:{kind:"conjunction",terms:[statement(v("x"),c("a")),{kind:"disjunction",terms:[v("x"),v("y")]}]},predicate:statement(v("z"),c("a"))};
  expect(nalQueryVariables([nested])).toEqual(["x","y","z"]);
  const definition={id:"q",name:"query",conditions:[nested],outputMode:"all" as const};
  expect(decodeNalQueryDefinitions(JSON.parse(JSON.stringify([definition])))).toEqual([definition]);
  expect(()=>decodeNalQueryDefinitions([{...definition,conditions:[{...nested,copula:null}]}])).toThrow("连接符");
  expect(()=>decodeNalQueryDefinitions([{...definition,outputVariables:["unknown"]}])).toThrow("输出变量");
  expect(()=>decodeNalQueryDefinitions([{...definition,outputVariables:["x","x"]}])).toThrow("输出变量");
});
it("projects only requested bindings and persists/rebuilds without losing the definition",()=>{
  const query:NalQuery={subject:{kind:"product",terms:[v("base"),v("next")]},predicate:c("follows")};
  const views=new NalQueryCollections();
  const definition={id:"q",name:"query",conditions:[query],outputVariables:["next"]};
  views.sync(state,new Set(["p1","p2"]),[definition]);
  expect(views.results()[0]?.paperIds).toEqual(["p2"]);
  expect(views.query([query],["base"]).paperIds).toEqual(["p1"]);
  expect(views.query([query],[]).paperIds).toEqual([]);
  expect(views.query([query],["next"]).bindings).toEqual([{next:{kind:"paper",id:"p2"}}]);
  const cache=decodeNalQueryCache(JSON.parse(JSON.stringify(views.export())));
  expect(cache).toBeDefined();
  const reopened=new NalQueryCollections(cache);
  expect(reopened.sync(state,new Set(["p1","p2"]),[definition]).matchedFacts).toBe(0);
  expect(reopened.results()[0]?.paperIds).toEqual(["p2"]);
  views.sync(state,new Set(["p1","p2"]),[{...definition,outputMode:"all"}]);
  expect(new Set(views.results()[0]?.paperIds)).toEqual(new Set(["p1","p2"]));
  expect(decodeNalQueryCache({...views.export(),version:1})).toBeUndefined();
});
it("matches existing implication rules structurally, treating conjunction as commutative",()=>{
  const query:NalQuery={copula:"implication",subject:v("premises"),predicate:v("conclusion")};
  const found=queryNal(state,query);
  expect(found).toHaveLength(1);expect(found[0]?.ruleIds).toEqual(["r"]);
  const actual=found[0]!.statement;
  if(!("terms" in actual.subject))throw new Error("expected conjunction");
  const reversed={...actual,subject:{...actual.subject,terms:[...actual.subject.terms].reverse()}};
  expect(queryNal(state,reversed)).toHaveLength(1);
  const permutations:NalQuery={copula:"implication",subject:{kind:"conjunction",terms:[v("a"),v("b")]},predicate:v("c")};
  expect(queryNal(state,permutations)).toHaveLength(2);
  const views=new NalQueryCollections();
  views.sync(state,new Set(["p1","p2"]),[{id:"q",name:"rule",conditions:[query],outputMode:"all"}]);
  expect(views.results()[0]?.bindings).toHaveLength(1);
  expect(views.query([permutations],["a","b"]).bindings).toHaveLength(2);
  expect(decodeNalQueryCache(JSON.parse(JSON.stringify(views.export())))).toBeDefined();
  views.sync({...state,rules:[]},new Set(["p1","p2"]),[{id:"q",name:"rule",conditions:[query],outputMode:"all"}]);
  expect(views.results()[0]?.bindings).toHaveLength(0);
  expect(queryNal(state,{subject:v("a"),predicate:v("b")})).toHaveLength(1);
});

it("rejects incomplete compound drafts from execution and persistence while still traversing their variables",()=>{
  const query:NalQuery={copula:"inheritance",subject:{kind:"compound",terms:[v("article"),c("a")]},predicate:c("relation")};
  expect(nalQueryVariables([query])).toEqual(["article"]);
  expect(()=>queryNal(state,query)).toThrow("连接符");
  expect(()=>decodeNalQueryDefinitions([{id:"q",name:"unfinished",conditions:[query]}])).toThrow("连接符");
});
