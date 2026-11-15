import { expect,it } from "vitest";
import { applyNalMutation,emptyNalState,parseNal,formatNalStatement,queryNal,inferNal,type NalTerm,type NalState,type NalVocabulary } from "./index";
const c=(id:string):NalTerm=>({kind:"concept",id}),p=(id:string):NalTerm=>({kind:"paper",id});
const product=(...terms:NalTerm[]):NalTerm=>({kind:"product",terms});
const state:NalState={...emptyNalState(),concepts:["领域","AI领域","深度学习领域","所属领域","方法","active inference方法","基于方法","研究发展"].map(id=>({id,label:id,explanation:id,revision:1})),statements:[
  {id:"deep-ai",subject:product(c("深度学习领域"),c("AI领域")),predicate:c("所属领域"),origin:"human"},
  {id:"ai-domain",subject:product(c("AI领域"),c("领域")),predicate:c("所属领域"),origin:"human"},
  {id:"paper3-deep",subject:product(p("文章3"),c("深度学习领域")),predicate:c("所属领域"),origin:"human"},
  {id:"method",subject:c("active inference方法"),predicate:c("方法"),origin:"human"},
  {id:"paper2-method",subject:product(p("文章2"),c("active inference方法")),predicate:c("基于方法"),origin:"human"},
  {id:"development",subject:product(p("文章1"),p("文章2")),predicate:c("研究发展"),origin:"human"},
],rules:[{id:"transitive:所属领域",kind:"transitive",relationConceptId:"所属领域"}]};
const vocabulary:readonly NalVocabulary[]=[...state.concepts.map(v=>({atom:{kind:"concept" as const,id:v.id},label:v.label})),...["文章1","文章2","文章3"].map(id=>({atom:{kind:"paper" as const,id},label:id}))];
it("returns paper 3 for the AI domain and all ancestor domains, using only the explicitly enabled relation rule",()=>{
  const result=queryNal(state,parseNal("(?文章 × AI领域) → 所属领域",vocabulary,true)).filter(m=>m.paperIds.length);
  expect(result.map(r=>r.paperIds)).toEqual([["文章3"]]);expect(new Set(result[0]?.statementIds)).toEqual(new Set(["paper3-deep","deep-ai"]));expect(result[0]?.ruleIds).toEqual(["transitive:所属领域"]);
  expect(new Set(queryNal(state,parseNal("(?文章 × 领域) → 所属领域",vocabulary,true)).find(m=>m.paperIds.length)?.statementIds)).toEqual(new Set(["paper3-deep","deep-ai","ai-domain"]));
  expect(state.statements).toHaveLength(6);
});
it("keeps custom relation arguments ordered and binds query variables consistently",()=>{
  expect(queryNal(state,parseNal("(文章1 × ?后续) → 研究发展",vocabulary,true))[0]?.paperIds).toEqual(["文章2"]);
  expect(queryNal(state,parseNal("(文章2 × 文章1) → 研究发展",vocabulary,true))).toEqual([]);
  expect(queryNal(state,parseNal("(?同一 × ?同一) → 研究发展",vocabulary,true))).toEqual([]);
  expect(queryNal(state,parseNal("(?文章 × 方法) → 基于方法",vocabulary,true))).toEqual([]);
});
it("terminates relation cycles and keeps other relation identities non-transitive",()=>{
  const cycle={...state,statements:[...state.statements,{id:"cycle",subject:product(c("领域"),c("深度学习领域")),predicate:c("所属领域"),origin:"human" as const}]};
  expect(queryNal(cycle,parseNal("(?文章 × AI领域) → 所属领域",vocabulary,true)).filter(m=>m.paperIds.length)).toHaveLength(1);
  expect(inferNal(cycle).length).toBeLessThan(30);
  expect(queryNal(state,parseNal("(文章2 × ?后续) → 研究发展",vocabulary,true))).toEqual([]);
});

it("omits hidden paper endpoints and preserves separate statement/definition notes",()=>{
  expect(queryNal(state,parseNal("(?文章 × AI领域) → 所属领域",vocabulary,true),new Set(["文章1"])).filter(m=>m.paperIds.length)).toEqual([]);
  const a=applyNalMutation(state,{kind:"link_annotation",annotation:{id:"a",targetKind:"concept",targetId:"AI领域",notePageId:"note-a"}},0);
  const b=applyNalMutation(a,{kind:"link_annotation",annotation:{id:"b",targetKind:"statement",targetId:"paper3-deep",notePageId:"note-b"}},1);
  const next=applyNalMutation(b,{kind:"delete_statement",id:"paper3-deep"},2);
  expect(next.annotations).toEqual([a.annotations[0]]);expect(next.concepts).toEqual(state.concepts);
  expect(()=>applyNalMutation(next,{kind:"unlink_annotation",id:"a"},0)).toThrow("变化");
});
it("round-trips expression labels, preserves identities, and rejects ambiguous names",()=>{
  for(const s of state.statements)expect(parseNal(formatNalStatement(s,vocabulary),vocabulary)).toEqual({subject:s.subject,predicate:s.predicate});
  expect(()=>parseNal("AI领域 → 领域",[...vocabulary,{atom:{kind:"concept",id:"other"},label:"AI领域"}])).toThrow("同名");
  expect(parseNal("concept:AI领域 --> 领域",vocabulary)).toEqual({subject:c("AI领域"),predicate:c("领域")});
  expect(()=>parseNal('"AI领域 → 领域',vocabulary)).toThrow("引号");
  expect(queryNal(state,parseNal("(?__proto__ × AI领域) → 所属领域",vocabulary,true)).find(m=>m.paperIds.length)?.paperIds).toEqual(["文章3"]);
  const tricky = [...vocabulary,{atom:{kind:"concept" as const,id:"literal"},label:"concept:AI领域"},{atom:{kind:"concept" as const,id:"punctuation"},label:"概念."}];
  const expression = {subject:c("literal"),predicate:c("punctuation")};
  expect(parseNal(formatNalStatement(expression,tricky),tricky)).toEqual(expression);
});
