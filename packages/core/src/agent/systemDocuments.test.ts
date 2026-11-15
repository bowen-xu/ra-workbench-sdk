import {expect,it} from "vitest";
import {systemDocumentId,systemDocumentIdFromPath,systemDocumentPath} from "./systemDocuments";
import addresses from "../../../../tests/fixtures/source-addresses.json";
it("resolves registered assets and legacy skill paths by source identity, never by display name",()=>{
  const path="source://agents/skills/edit-structured-resources/SKILL.md";
  expect(systemDocumentPath("edit-structured-resources")).toBe(path);
  expect(systemDocumentIdFromPath(path)).toBe("edit-structured-resources");
  expect(systemDocumentId({type:"skill",name:"renamed label",identity:{environment_id:"application",source_id:".agents/skills/edit-structured-resources/SKILL.md",revision:"ignored"}})).toBe("edit-structured-resources");
  expect(systemDocumentIdFromPath("source://agents/skills/missing/SKILL.md")).toBeUndefined();
  expect(systemDocumentPath("__proto__")).toBeUndefined();
  expect(systemDocumentId({type:"skill",name:"edit-structured-resources",identity:{environment_id:"application",source_id:".agents/skills/missing/SKILL.md",revision:"ignored"}})).toBeUndefined();
});
it("normalizes registered Agent paths while preserving segment identity",()=>{
  expect(systemDocumentIdFromPath("source://agents/prompts/./%73tructured-task.md")).toBe("structured-task");
  expect(systemDocumentIdFromPath("source://agents/prompts%2Fstructured-task.md")).toBeUndefined();
  expect(systemDocumentIdFromPath("source://agents/prompts/structured-task.md:#line{1-1:1-2}")).toBeUndefined();
});
it.each(addresses.unregistered)("does not alias unregistered %s to a built-in document",path=>{
  expect(systemDocumentIdFromPath(path)).toBeUndefined();
});
