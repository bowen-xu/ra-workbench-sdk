import { expect,it } from "vitest";
import { applyNalMutation,decodeNalState,emptyNalState,nalConceptKind,type NalState } from "./index";
const base:NalState={...emptyNalState(),concepts:[
  {id:"domain",label:"AI领域",explanation:"领域",revision:1,conceptKind:"ordinary"},
  {id:"relation",label:"所属领域",explanation:"关系",revision:1,conceptKind:"relation"},
]};

it("persists explicit kinds by identity and keeps same-name concepts independent",()=>{
  const renamed={...base,concepts:base.concepts.map(c=>({...c,label:"同名"}))};
  const next=applyNalMutation(renamed,{kind:"set_concept_kind",conceptId:"domain",conceptKind:"relation"},0);
  expect(next.concepts.map(c=>c.conceptKind)).toEqual(["relation","relation"]);
  const ordinary=applyNalMutation(next,{kind:"set_concept_kind",conceptId:"relation",conceptKind:"ordinary"},1);
  expect(ordinary.concepts.map(c=>c.conceptKind)).toEqual(["relation","ordinary"]);
  expect(ordinary.concepts.map(c=>c.id)).toEqual(["domain","relation"]);
});

it("only relation concepts may own rules and active relation uses protect the kind",()=>{
  expect(()=>applyNalMutation(base,{kind:"set_transitivity",relationConceptId:"domain",enabled:true},0)).toThrow("只有关系概念");
  const next=applyNalMutation(base,{kind:"set_transitivity",relationConceptId:"relation",enabled:true},0);
  expect(()=>applyNalMutation(next,{kind:"set_concept_kind",conceptId:"relation",conceptKind:"ordinary"},1)).toThrow("先移除");
  const used={...base,statements:[{id:"s",origin:"human" as const,subject:{kind:"product" as const,terms:[{kind:"concept" as const,id:"domain"},{kind:"concept" as const,id:"domain"}]},predicate:{kind:"concept" as const,id:"relation"}}]};
  expect(()=>applyNalMutation(used,{kind:"set_concept_kind",conceptId:"relation",conceptKind:"ordinary"},0)).toThrow("先移除");
});

it("upgrades old roles from saved usage, never from a concept name",()=>{
  const old={...base,concepts:base.concepts.map(({conceptKind:_,...c})=>c),rules:[{id:"r",kind:"transitive" as const,relationConceptId:"relation"}]};
  const decoded=decodeNalState(old);
  expect(decoded.concepts.map(c=>c.conceptKind)).toEqual(["ordinary","relation"]);
  expect(nalConceptKind({id:"unused",label:"所属领域",explanation:"同名普通概念",revision:1},base)).toBe("ordinary");
  expect(()=>decodeNalState({...base,concepts:[{...base.concepts[0],conceptKind:"unknown"}]})).toThrow("类型无效");
});
