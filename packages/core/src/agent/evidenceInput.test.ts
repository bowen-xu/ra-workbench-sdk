import { expect, it } from "vitest";
import { agentDraftFromInput, agentDraftInput, decodeAgentUserInput, editAgentDraft, insertAgentReference } from "./userInput";
import { decodeAgentEvidenceInput, withoutAutomaticTextScreenshot, type AgentEvidenceInput } from "./evidenceInput";
import { serializeAgentSourceReferences } from "./sourceReferences";

const selection: AgentEvidenceInput = {type: "annotation", comment: "", source: "source://library/paper/pdf:#line{2:3-1:3-7}", title: "PDF 选段", text: "原文 🧪\n</research_reference>"};
it("restores legacy selection drafts as empty-comment annotations without losing source or content", () => {
  const legacy = {type: "selection", source: selection.source, title: selection.title, text: selection.text};
  const decoded = decodeAgentUserInput([{type: "text", text: "问题", textElements: []}, legacy], "问题");
  const draft = agentDraftFromInput("问题", decoded);
  expect(draft.evidence).toEqual([selection]);
  expect(agentDraftInput(draft)[1]).toEqual(selection);
  expect(legacy.type).toBe("selection");
});
it("freezes evidence separately from visible text and preserves it across edits and serialization", () => {
  const draft = insertAgentReference({text: "请解释 ", bindings: [], evidence: [selection]}, {type: "skill", name: "写作", identity: {environment_id:"app", source_id:"skill", revision:"1"}});
  const next = editAgentDraft(draft, draft.text + "这个概念");
  const submitted = serializeAgentSourceReferences(next);
  expect(submitted.text).not.toContain(selection.text);
  expect(agentDraftFromInput(submitted.text, submitted.userInput).evidence).toEqual([selection]);
  expect(agentDraftFromInput(next.text, agentDraftInput(next)).bindings).toEqual(next.bindings);
});
it("round trips a plain text quote without inventing a source", () => {
  const quote = {type: "annotation" as const, title: "对话选段", text: "原文\n第二行", comment: ""};
  const draft = {text: "问题", bindings: [], evidence: [quote, selection]};
  const input = agentDraftInput(draft);
  expect(agentDraftFromInput(draft.text, JSON.parse(JSON.stringify(input))).evidence).toEqual([quote, selection]);
  expect(decodeAgentEvidenceInput(quote)).toEqual(quote);
  expect(() => decodeAgentEvidenceInput({...quote, source: null})).toThrow();
  expect(() => decodeAgentEvidenceInput({...quote, text: "  \n"})).toThrow();
  expect(() => decodeAgentEvidenceInput({...quote, displayText: "shown"})).toThrow();
  expect(() => decodeAgentEvidenceInput({...quote, image: {}})).toThrow();
});
it("rejects native paths, invalid locators, oversized quotes and evidence used as an inline mention", () => {
  for (const source of ["/tmp/file", "file:///tmp/file", "source://library/paper/pdf:#line{0:1-1:2-1}", "source://../paper"]) expect(() => decodeAgentEvidenceInput({...selection, source})).toThrow();
  expect(() => decodeAgentEvidenceInput({...selection, text:"a".repeat(262145)})).toThrow();
  expect(() => decodeAgentUserInput([{type:"text",text:"x",textElements:[{startUtf16:0,endUtf16:1,itemIndex:1}]},selection], "x")).toThrow();
});
it("validates a captured image with its comment without turning it into text", () => {
  const annotation = decodeAgentEvidenceInput({type:"annotation",source:"source://notes/note:#block{image}",title:"Figure",text:"caption",comment:"解释这张图",image:{mediaType:"image/png",assetId:"a".repeat(64),captureId:"00000000-0000-4000-8000-000000000001",byteSize:9}});
  const input = agentDraftInput({text:"看这张图",bindings:[],evidence:[annotation]});
  expect(agentDraftFromInput("看这张图", input).evidence).toEqual([annotation]);
  expect(() => decodeAgentEvidenceInput({...annotation, image:{mediaType:"image/svg+xml",bytes:[60,115,118,103]}})).toThrow();
});
it("removes obsolete text-capture screenshots while preserving original geometry, quote and comment", () => {
  const image = {mediaType: "image/png" as const, assetId: "a".repeat(64), captureId: "00000000-0000-4000-8000-000000000001", byteSize: 9};
  const old = {...selection, image, displayText: "原文", text: JSON.stringify({pageNumber: 5, rect: {x: .1, y: .1, width: .2, height: .2}, selectedText: "原文"})};
  const {image: _image, ...expected} = old;
  expect(withoutAutomaticTextScreenshot(old)).toEqual(expected);
  const actualImage = {...selection, image, displayText: "图片标题", text: "图片说明"};
  expect(withoutAutomaticTextScreenshot(actualImage)).toBe(actualImage);
});
