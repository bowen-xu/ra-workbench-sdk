import {describe, expect, it} from "vitest";
import {agentDraftInput, decodeAgentUserInput, editAgentDraft, insertAgentReference, type AgentInputDraft, type AgentReferenceInput} from "./userInput";
const skill: AgentReferenceInput = {type: "skill", name: "review", identity: {environment_id: "application", source_id: ".agents/skills/review/SKILL.md", revision: "one"}};
describe("Codex structured input bindings", () => {
  it("keeps several identities separate from their displayed text", () => {
    let draft: AgentInputDraft = {text: "请检查", bindings: []};
    draft = insertAgentReference(draft, skill);
    draft = insertAgentReference(draft, {...skill, identity: {...skill.identity, environment_id: "manuscript:one"}});
    const input = agentDraftInput(draft);
    expect(decodeAgentUserInput(input, draft.text)).toEqual(input);
    expect(input).toHaveLength(3);
  });
  it("moves UTF-16 bindings with edits and removes edited references", () => {
    const draft = insertAgentReference({text: "😀 ", bindings: []}, skill);
    const moved = editAgentDraft(draft, "新增 " + draft.text);
    expect(moved.bindings[0]?.startUtf16).toBe(draft.bindings[0]!.startUtf16 + 3);
    expect(editAgentDraft(moved, moved.text.replace("@review", "@other")).bindings).toEqual([]);
    expect(decodeAgentUserInput(undefined, "legacy")).toEqual([]);
  });
  it("rejects text mismatch and forged or out-of-range elements", () => {
    const draft = insertAgentReference({text: "", bindings: []}, skill);
    expect(() => decodeAgentUserInput(agentDraftInput(draft), "different")).toThrow();
    expect(() => decodeAgentUserInput([{type: "text", text: "x", textElements: [{startUtf16: 0, endUtf16: 1, itemIndex: 2}]}], "x")).toThrow();
    expect(() => decodeAgentUserInput([{type: "text", text: "x", textElements: []}, {type: "skill", name: "review", path: "/private/file"}], "x")).toThrow();
  });
});

it("accepts file references without a content revision, while reading legacy tags",()=>{
  const file: AgentReferenceInput={type:"mention",name:"文件",target:{kind:"file",sourceId:"source",resourceId:"file"}};
  const draft=insertAgentReference({text:"读取",bindings:[]},file),input=agentDraftInput(draft);
  expect(decodeAgentUserInput(input,draft.text)).toEqual(input);
  const legacy=JSON.parse(JSON.stringify(input)) as unknown as [{type:string}, {target:{revision?:string}}];
  legacy[1].target.revision="old";
  expect(()=>decodeAgentUserInput(legacy,draft.text)).not.toThrow();
});
