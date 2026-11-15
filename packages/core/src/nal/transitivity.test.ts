import { expect, it } from "vitest";
import { applyNalMutation, emptyNalState, inferNal, queryNal, type NalState, type NalTerm } from "./index";

const c = (id: string): NalTerm => ({kind:"concept",id});
const p = (id: string): NalTerm => ({kind:"paper",id});
const pair = (a: NalTerm,b: NalTerm): NalTerm => ({kind:"product",terms:[a,b]});
const base: NalState = {...emptyNalState(),concepts:["AI","DL","belongs","other"].map(id=>({id,label:id,explanation:id,revision:0})),statements:[
  {id:"domain",subject:pair(c("DL"),c("AI")),predicate:c("belongs"),origin:"human"},
  {id:"paper-dl",subject:pair(p("3"),c("DL")),predicate:c("belongs"),origin:"human"},
  {id:"paper-ai",subject:pair(p("4"),c("AI")),predicate:c("belongs"),origin:"human"},
]};
const query = (from:NalTerm,to:NalTerm,relation="belongs") => ({subject:pair(from,to),predicate:c(relation)});

it("requires a saved per-relation rule and never propagates membership in reverse",()=>{
  expect(queryNal(base,query(p("3"),c("AI")))).toEqual([]);
  const enabled=applyNalMutation(base,{kind:"set_transitivity",relationConceptId:"belongs",enabled:true},0);
  const result=queryNal(enabled,query(p("3"),c("AI")));
  expect(result).toHaveLength(1);
  expect(new Set(result[0]?.statementIds)).toEqual(new Set(["domain","paper-dl"]));
  expect(result[0]?.statement.derived).toBe(true);
  expect(queryNal(enabled,query(p("4"),c("DL")))).toEqual([]);
  const disabled=applyNalMutation(enabled,{kind:"set_transitivity",relationConceptId:"belongs",enabled:false},1);
  expect(queryNal(disabled,query(p("3"),c("AI")))).toEqual([]);
  expect(disabled.statements).toEqual(base.statements);
});

it("does not substitute either product argument using concept inheritance",()=>{
  const state={...base,statements:[...base.statements,{id:"old-arrow",subject:c("DL"),predicate:c("AI"),origin:"human" as const}]};
  expect(queryNal(state,query(p("3"),c("AI")))).toEqual([]);
  expect(queryNal(state,query(p("4"),c("DL")))).toEqual([]);
});

it("still supports transitive inheritance of complete terms",()=>{
  const state={...base,statements:[
    {id:"a",subject:c("DL"),predicate:c("AI"),origin:"human" as const},
    {id:"b",subject:c("AI"),predicate:c("other"),origin:"human" as const},
  ]};
  const result=queryNal(state,{subject:c("DL"),predicate:c("other")});
  expect(result[0]?.ruleIds).toEqual(["builtin:inheritance-transitivity"]);
  expect(new Set(result[0]?.statementIds)).toEqual(new Set(["a","b"]));
});

it("does not join different relation identities or leak hidden intermediate papers",()=>{
  const enabled=applyNalMutation(base,{kind:"set_transitivity",relationConceptId:"belongs",enabled:true},0);
  const state={...enabled,statements:[...base.statements,
    {id:"a",subject:pair(p("1"),p("hidden")),predicate:c("belongs"),origin:"human" as const},
    {id:"b",subject:pair(p("hidden"),c("AI")),predicate:c("belongs"),origin:"human" as const},
    {id:"c",subject:pair(c("AI"),c("other")),predicate:c("other"),origin:"human" as const},
  ]};
  expect(queryNal(state,query(p("1"),c("AI")),new Set(["1","3","4"]))).toEqual([]);
  expect(queryNal(state,query(p("3"),c("other")))).toEqual([]);
  expect(()=>applyNalMutation(enabled,{kind:"set_transitivity",relationConceptId:"missing",enabled:true},1)).toThrow("无效");
});

it("reports the inference budget instead of silently returning a partial result",()=>{
  const state={...base,statements:Array.from({length:20001},(_,i)=>({id:`s${i}`,subject:p(`${i}`),predicate:c("AI"),origin:"human" as const}))};
  expect(()=>inferNal(state)).toThrow("20000");
});

it("applies the same schema to any chosen relation, including inherited relation predicates",()=>{
  const state={...base,statements:[
    {id:"a",subject:pair(p("1"),p("2")),predicate:c("belongs"),origin:"human" as const},
    {id:"b",subject:pair(p("2"),p("3")),predicate:c("other"),origin:"human" as const},
    {id:"class",subject:c("belongs"),predicate:c("other"),origin:"human" as const},
  ]};
  const enabled=applyNalMutation(state,{kind:"set_transitivity",relationConceptId:"other",enabled:true},0);
  const result=queryNal(enabled,query(p("1"),p("3"),"other"));
  expect(result).toHaveLength(1);
  expect(new Set(result[0]?.statementIds)).toEqual(new Set(["a","b","class"]));
  expect(new Set(result[0]?.ruleIds)).toEqual(new Set(["builtin:inheritance-transitivity","transitive:other"]));
});
