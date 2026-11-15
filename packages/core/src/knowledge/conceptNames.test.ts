import {expect,it} from "vitest";
import {assertAvailableConceptName,importedConceptName,splitConceptName,validateConceptName} from "./conceptNames";

it("keeps complete contextual names unique across concept kinds",()=>{
  const concepts=[{id:"a",label:"感知`AI"},{id:"b",label:"感知`心理学"}];
  expect(()=>assertAvailableConceptName(" 感知`AI ",concepts)).toThrow("已存在");
  expect(assertAvailableConceptName("感知`哲学",concepts)).toBe("感知`哲学");
  expect(splitConceptName("感知`AI")).toEqual({name:"感知",context:"`AI"});
  expect(splitConceptName("所属领域")).toEqual({name:"所属领域",context:""});
  for(const label of ["","`AI","感知`","感知``AI"])expect(()=>validateConceptName(label)).toThrow();
});

it("preserves historical homonyms but rejects new collisions and supports either rename",()=>{
  const a={id:"a",label:"感知"},b={id:"b",label:"感知"},concepts=[a,b];
  expect(assertAvailableConceptName("感知",concepts,a)).toBe("感知");
  expect(()=>assertAvailableConceptName("感知",concepts)).toThrow("已存在");
  expect(assertAvailableConceptName("感知`AI",concepts,a)).toBe("感知`AI");
  expect(()=>assertAvailableConceptName("感知`AI",[{...a,label:"感知`AI"},b],b)).toThrow("已存在");
});

it("imports old collection identities under available names without renaming existing concepts",()=>{
  const old=[{label:"领域"},{label:"领域`旧归类-2"}];
  expect(importedConceptName("领域",old)).toBe("领域`旧归类-3");
  expect(importedConceptName("方法",old)).toBe("方法");
});
