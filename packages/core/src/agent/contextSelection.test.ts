import { describe, expect, it } from "vitest";
import { EMPTY_AGENT_CONTEXT, agentContextGroupParts, agentContextPathAccess, agentContextKey, decodeAgentContextResource, decodeAgentContextState, freezeAgentContext, selectAgentContext, removeAgentContext, type AgentContextGroupResource } from "./contextSelection";

it("enforces a group ceiling while retaining child preferences through persistence", () => {
    const group: AgentContextGroupResource = {kind:"manuscript",resourceId:"project",newMemberAccess:"readWrite",groupAccess:"readWrite",parts:[
        {resource:{kind:"manuscriptFile",resourceId:"project",path:"main.tex"},label:"Main",selected:true,access:"readWrite"},
        {resource:{kind:"manuscriptFile",resourceId:"project",path:"fixed.tex"},label:"Fixed",selected:true,access:"readOnly"},
    ]};
    const stored = freezeAgentContext(selectAgentContext(EMPTY_AGENT_CONTEXT,{label:"Project",resource:{...group,groupAccess:"readOnly"}},"persistent"))[0]!.resource as AgentContextGroupResource;
    expect(agentContextGroupParts(group,stored).map(part=>part.access)).toEqual(["readOnly","readOnly"]);
    expect(agentContextPathAccess(stored,"main.tex",true)).toBe(false);
    expect(agentContextPathAccess(stored,"new.tex",true)).toBe(false);
    expect(agentContextPathAccess(stored,"main.tex")).toBe(true);
    const restored={...stored,groupAccess:"readWrite" as const};
    expect(agentContextGroupParts(group,restored).map(part=>part.access)).toEqual(["readWrite","readOnly"]);
    expect(()=>decodeAgentContextResource({...group,groupAccess:"invalid"})).toThrow();
    expect(decodeAgentContextResource({kind:"noteGroup",resourceId:"note",parts:[],newMemberAccess:"readWrite",groupAccess:"readWrite"})).toMatchObject({groupAccess:"readWrite"});
});
const a = { resource: { kind: "paper" as const, resourceId: "paper-a", attachmentId: "pdf-a" }, label: "Paper A" };
const b = { resource: { kind: "paper" as const, resourceId: "paper-b", attachmentId: "pdf-b" }, label: "Paper B" };
it("keeps conversation selections independent and freezes source identities before navigation", () => {
    const first = selectAgentContext(selectAgentContext(EMPTY_AGENT_CONTEXT, a, "persistent"), b, "temporary");
    const second = selectAgentContext(EMPTY_AGENT_CONTEXT, b, "persistent");
    const submission = freezeAgentContext(first);
    const changed = removeAgentContext(first, a.resource);
    expect(changed.persistent).toEqual([]);
    expect(submission.map(s => s.label)).toEqual(["Paper A", "Paper B"]);
    expect(second.persistent).toEqual([b]);
    expect(second.temporary).toEqual([]);
    expect(submission[0]!.resource).not.toBe(a.resource);
    expect(EMPTY_AGENT_CONTEXT.persistent).toEqual([]);
});
it("freezes child selections and permissions without conflating them with object identity", () => {
    const group:AgentContextGroupResource={kind:"paperGroup",resourceId:"paper-a",parts:[{resource:a.resource,label:"PDF",selected:true,access:"readOnly"},{resource:{kind:"paperMetadata",resourceId:"paper-a"},label:"元数据",selected:false,access:"readWrite"}]};
    const frozen=freezeAgentContext(selectAgentContext(EMPTY_AGENT_CONTEXT,{resource:group,label:"Paper A"},"persistent"));
    const changed={...group,parts:group.parts.map(part=>({...part,selected:!part.selected}))};
    expect(agentContextKey(group)).toBe(agentContextKey(changed));
    expect(frozen[0]?.resource).toEqual(group);
    expect((frozen[0]?.resource as AgentContextGroupResource).parts).not.toBe(group.parts);
    expect(()=>decodeAgentContextResource({...group,parts:[{...group.parts[0],access:"readWrite"}]})).toThrow("PDF");
    expect(()=>decodeAgentContextResource({...group,parts:[{...group.parts[0],resource:b.resource}]})).toThrow();
    expect(()=>decodeAgentContextResource({...group,parts:[{...group.parts[0],resource:group}]})).toThrow();
});
it("promotes a temporary source without duplicate injection and preserves precise PDF identity", () => {
    const temporary = selectAgentContext(EMPTY_AGENT_CONTEXT, a, "temporary");
    const pinned = selectAgentContext(temporary, a, "persistent");
    expect(pinned.temporary).toEqual([]);
    expect(freezeAgentContext(pinned)).toHaveLength(1);
    expect(agentContextKey(a.resource)).not.toBe(agentContextKey({ ...a.resource, attachmentId: "another-pdf" }));
    expect(agentContextKey(a.resource)).not.toBe(agentContextKey({ ...a.resource, pageIndex: 0 }));
});
it("rejects unsafe paths, duplicate persisted identities and excess selections", () => {
    expect(() => decodeAgentContextState({ schemaVersion: 1, persistent: [a], temporary: [a] })).toThrow();
    expect(() => selectAgentContext(EMPTY_AGENT_CONTEXT, { resource: { kind: "manuscriptFile", resourceId: "x", path: "../outside.tex" }, label: "Outside" }, "temporary")).toThrow();
    expect(() => decodeAgentContextState({ schemaVersion: 1, persistent: Array.from({ length: 33 }, (_, i) => ({ ...a, resource: { ...a.resource, resourceId: `paper-${i}` } })), temporary: [] })).toThrow();
    expect(() => decodeAgentContextState({ schemaVersion: 2, persistent: [], temporary: [] })).toThrow();
});

it("preserves dynamic reading-note scopes and exclusions without freezing note membership", () => {
    const resource={kind:"paperNotes" as const,resourceId:"paper",excludedNoteIds:["excluded"]};
    const state=selectAgentContext(EMPTY_AGENT_CONTEXT,{resource,label:"阅读笔记"},"persistent");
    expect(freezeAgentContext(state)[0]!.resource).toEqual(resource);
    expect(()=>selectAgentContext(EMPTY_AGENT_CONTEXT,{resource:{...resource,excludedNoteIds:["duplicate","duplicate"]},label:"阅读笔记"},"persistent")).toThrow();
});

it("inherits new members only for explicit whole-object scopes and preserves exclusions and access overrides", () => {
    const old: AgentContextGroupResource = {kind:"manuscript",resourceId:"project",parts:[
        {resource:{kind:"manuscriptFile",resourceId:"project",path:"excluded.tex"},label:"Excluded",selected:false,access:"readWrite"},
        {resource:{kind:"manuscriptFile",resourceId:"project",path:"read.tex"},label:"Read",selected:true,access:"readOnly"},
    ]};
    const current: AgentContextGroupResource = {...old,parts:[...old.parts,{resource:{kind:"manuscriptFile",resourceId:"project",path:"new.tex"},label:"New",selected:true,access:"readOnly"}]};
    expect(agentContextGroupParts(current,old)[2]?.selected).toBe(false);
    const scope = {...old,newMemberAccess:"readWrite" as const};
    expect(agentContextGroupParts(current,scope).map(part=>[part.selected,part.access])).toEqual([[false,"readWrite"],[true,"readOnly"],[true,"readWrite"]]);
    expect(agentContextPathAccess(scope,"sections/new.tex",true)).toBe(true);
    expect(agentContextPathAccess(scope,"read.tex",true)).toBe(false);
    expect(agentContextPathAccess(scope,"excluded.tex",true)).toBe(false);
    expect(agentContextPathAccess(scope,"../outside.tex",true)).toBe(false);
    expect(agentContextPathAccess(scope,"credentials.key",true)).toBe(false);
    const compact=freezeAgentContext(selectAgentContext(EMPTY_AGENT_CONTEXT,{resource:scope,label:"Project"},"persistent"))[0]?.resource as AgentContextGroupResource;
    expect(agentContextGroupParts(current,compact).map(part=>[part.selected,part.access])).toEqual([[false,"readWrite"],[true,"readOnly"],[true,"readWrite"]]);
    expect(compact.parts.every(part=>part.label === "权限覆盖")).toBe(true);
    expect(()=>decodeAgentContextResource({...scope,newMemberAccess:"unknown"})).toThrow();
    expect(()=>decodeAgentContextResource({kind:"noteGroup",resourceId:"note",parts:[],newMemberAccess:"readOnly"})).toThrow();
    expect(decodeAgentContextResource({...scope,parts:[]})).toEqual({...scope,parts:[]});
});
it("new PDFs remain read-only and new notes stay owned by the reading-notes scope",()=>{
    const scope: AgentContextGroupResource={kind:"paperGroup",resourceId:"paper",parts:[],newMemberAccess:"readWrite"};
    const current: AgentContextGroupResource={...scope,parts:[
        {resource:{kind:"paper",resourceId:"paper",attachmentId:"new"},label:"PDF",selected:false,access:"readOnly"},
        {resource:{kind:"note",resourceId:"note"},label:"Note",selected:false,access:"readOnly"},
    ]};
    expect(agentContextGroupParts(current,scope).map(part=>[part.selected,part.access])).toEqual([[true,"readOnly"],[false,"readWrite"]]);
});

it("persists only parent identity and permission defaults as the inventory grows",()=>{
    const inventory:AgentContextGroupResource={kind:"paperGroup",resourceId:"paper",newMemberAccess:"readOnly",parts:[
        {resource:{kind:"paperNotes",resourceId:"paper",excludedNoteIds:[]},label:"Notes",selected:true,access:"readOnly"},
        ...Array.from({length:120},(_,i)=>({resource:{kind:"note" as const,resourceId:`note-${i}`},label:`Private note ${i}`,selected:false,access:"readOnly" as const})),
    ]};
    const state=selectAgentContext(EMPTY_AGENT_CONTEXT,{resource:inventory,label:"Paper"},"persistent");
    expect(state.persistent[0]?.resource).toEqual({kind:"paperGroup",resourceId:"paper",newMemberAccess:"readOnly",parts:[]});
    expect(JSON.stringify(state)).not.toContain("Private note");
    expect(agentContextGroupParts(inventory,state.persistent[0]!.resource as AgentContextGroupResource)[0]?.selected).toBe(true);
});

describe("structured object context",()=>{
  it("accepts separately authorized identities without giving a template catalog ownership",()=>{
    expect(decodeAgentContextResource({kind:"structuredObject",resourceId:"object",access:"readWrite"})).toEqual({kind:"structuredObject",resourceId:"object",access:"readWrite"});
    expect(decodeAgentContextResource({kind:"templateCatalog",resourceId:"catalog",access:"readWrite"}).kind).toBe("templateCatalog");
    expect(()=>decodeAgentContextResource({kind:"paperGroup",resourceId:"paper",parts:[{resource:{kind:"structuredObject",resourceId:"object"},label:"画像",selected:true,access:"readWrite"}]})).not.toThrow();
    expect(()=>decodeAgentContextResource({kind:"paperGroup",resourceId:"paper",parts:[{resource:{kind:"templateCatalog",resourceId:"catalog"},label:"目录",selected:true,access:"readWrite"}]})).toThrow();
  });
});
