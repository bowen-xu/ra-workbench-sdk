import { expect, it } from "vitest";
import { agentDraftFromInput, insertAgentReference, type AgentReferenceInput } from "./userInput";
import { agentFileSourceLink, serializeAgentSourceReferences, restoreAgentSourceDraft } from "./sourceReferences";

const file: AgentReferenceInput = {type: "mention", name: "同名 [PDF]", target: {kind: "file", sourceId: 'context:{"kind":"paper","resourceId":"paper","attachmentId":"pdf"}', resourceId: "paper", revision: "current"}};
const skill: AgentReferenceInput = {type: "skill", name: "写作", identity: {environment_id: "app", source_id: "academic", revision: "v1"}};
it("serializes selected files and remaps Unicode spans without losing independent skill identity", () => {
  let draft = insertAgentReference({text: "  🧪 参考 ", bindings: []}, file);
  draft = insertAgentReference(draft, skill);
  const wire = serializeAgentSourceReferences(draft);
  expect(wire.text).toBe("🧪 参考 [同名 \\[PDF\\]](source://library/paper/pdf) @写作");
  const restored = agentDraftFromInput(wire.text, wire.userInput);
  expect(restored.bindings.map(binding => binding.input)).toEqual([file, skill]);
  expect(restored.bindings.map(binding => wire.text.slice(binding.startUtf16, binding.endUtf16))).toEqual(["[同名 \\[PDF\\]](source://library/paper/pdf)", "@写作"]);
  expect(serializeAgentSourceReferences(restored)).toEqual(wire);
  expect(serializeAgentSourceReferences(restoreAgentSourceDraft(restored))).toEqual(wire);
  expect(restoreAgentSourceDraft(restored).text).toBe("🧪 参考 @同名 [PDF] @写作");
  expect(draft.text).toContain("@同名 [PDF]");
});
it("keeps unselected @ text literal and unknown legacy references intact", () => {
  expect(serializeAgentSourceReferences({text: "  @PDF  ", bindings: []})).toEqual({text: "@PDF", userInput: []});
  const legacy: AgentReferenceInput = {...file, target: {kind: "file", sourceId: "legacy", resourceId: "unknown", revision: "v1"}};
  expect(serializeAgentSourceReferences(insertAgentReference({text: "", bindings: []}, legacy)).text).toBe("@同名 [PDF]");
});
it("formats project-relative file identities as nested virtual paths", () => {
  const target: AgentReferenceInput = {...file, target: {kind: "file", sourceId: 'context:{"kind":"manuscriptFile","resourceId":"project","path":"sections/引言.tex"}', resourceId: "project", revision: "current"}};
  expect(agentFileSourceLink(target)).toBe("source://writings/project/sections/%E5%BC%95%E8%A8%80.tex");
});
it("uses exact structured resource addresses and keeps missing addresses as ordinary bound text", () => {
  const target: AgentReferenceInput = {type:"mention",name:"模板",target:{kind:"file",sourceId:'context:{"kind":"structuredObject","resourceId":"template"}',resourceId:"template",sourceUrl:"source://agents/skills/edit-structured-resources/assets/reading/template.json"}};
  expect(agentFileSourceLink(target)).toBe("source://agents/skills/edit-structured-resources/assets/reading/template.json");
  expect(serializeAgentSourceReferences(insertAgentReference({text:"",bindings:[]},target)).text).toContain("](source://agents/skills/");
  const missing: AgentReferenceInput = {...target,target:{kind:"file",sourceId:'context:{"kind":"structuredObject","resourceId":"missing"}',resourceId:"missing"}};
  expect(serializeAgentSourceReferences(insertAgentReference({text:"",bindings:[]},missing)).text).toBe("@模板");
});
