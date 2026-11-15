import { expect,it } from "vitest";
import { emptyNalState,NalQueryCollections,decodeNalQueryDefinitions,decodeNalQueryCache,nalQueryVariables,type NalQueryBlock,type NalQuery,type NalQueryGroup,type NalStatement } from "./index";
const c=(id:string)=>({kind:"concept" as const,id}),p=(id:string)=>({kind:"paper" as const,id});
const q=(id:string,name="x"):NalQuery=>({subject:{kind:"variable",name},predicate:c(id)});
const and=(...children:NalQueryBlock[]):NalQueryGroup=>({kind:"group",connector:"conjunction",children});
const or=(...children:NalQueryBlock[]):NalQueryGroup=>({kind:"group",connector:"disjunction",children});
const fact=(paper:string,predicate:string):NalStatement=>({id:`${paper}:${predicate}`,origin:"human",subject:p(paper),predicate:c(predicate)});
const state={...emptyNalState(),statements:[fact("1","A"),fact("2","B"),fact("3","A"),fact("3","C"),fact("4","D")]};
const active=new Set(["1","2","3","4"]);
it("evaluates nested AND/OR groups without flattening precedence and persists their boundaries",()=>{
  const conditions=[or(q("B"),and(q("A"),q("C")))];
  const def={id:"q",name:"grouped",conditions,outputMode:"all" as const};
  expect(decodeNalQueryDefinitions([def])).toEqual([def]);
  const views=new NalQueryCollections();views.sync(state,active,[def]);
  expect(new Set(views.results()[0]?.paperIds)).toEqual(new Set(["2","3"]));
  expect(views.query([and(or(q("A"),q("B")),q("C"))],["x"]).paperIds).toEqual(["3"]);
  const cache=decodeNalQueryCache(JSON.parse(JSON.stringify(views.export())));expect(cache).toBeDefined();
  const reopened=new NalQueryCollections(cache);expect(reopened.sync(state,active,[def]).matchedFacts).toBe(0);
  reopened.sync({...state,statements:state.statements.filter(s=>s.id!=="3:C")},active,[def]);
  expect(reopened.results()[0]?.paperIds).toEqual(["2"]);
  expect(nalQueryVariables([or(q("A","x"),and(q("B","y"),q("C","x")))])).toEqual(["x","y"]);
});
it("keeps branch-local bindings through joins and only projects selected variables at the end",()=>{
  const views=new NalQueryCollections();views.sync(state,active,[]);
  const conditions=[or(q("A","x"),q("B","y")),q("C","x")];
  const bindings=views.query(conditions,["x","y"]).bindings;
  expect(bindings).toEqual(expect.arrayContaining([{x:p("3")},{x:p("3"),y:p("2")} ]));
  expect(bindings).toHaveLength(2);
  expect(views.query(conditions,["y"]).paperIds).toEqual(["2"]);
  expect(views.query(conditions,[]).paperIds).toEqual([]);
});
it("conjoins ancestor groups and deduplicates OR outputs",()=>{
  const views=new NalQueryCollections();
  views.sync(state,active,[{id:"parent",name:"p",conditions:[or(q("A"),q("B"),q("A"))],outputMode:"all"},{id:"child",name:"c",parentId:"parent",conditions:[q("C")],outputMode:"all"}]);
  expect(new Set(views.results()[0]?.paperIds)).toEqual(new Set(["1","2","3"]));
  expect(views.results()[1]?.paperIds).toEqual(["3"]);
});
it("rejects empty, invalid, overly nested groups and total leaf counts over the path limit",()=>{
  const def=(conditions:unknown)=>[{id:"q",name:"q",conditions}];
  expect(()=>decodeNalQueryDefinitions(def([{kind:"group",connector:"disjunction",children:[]}]))).toThrow();
  expect(()=>decodeNalQueryDefinitions(def([{kind:"group",connector:"product",children:[q("A")]}]))).toThrow();
  let nested:NalQueryBlock=q("A");for(let n=0;n<14;n++)nested=and(nested);
  expect(()=>decodeNalQueryDefinitions(def([nested]))).toThrow();
  expect(()=>decodeNalQueryDefinitions(def([or(...Array.from({length:16},()=>q("A"))),q("B")]))).toThrow("16");
});
