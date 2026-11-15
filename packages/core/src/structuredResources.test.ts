import { describe,expect,it } from "vitest";
import { decodeStructuredResource, decodeStructuredWriteResult, replaceStructuredFieldText, structuredResourceFields, structuredResourceDiffFields } from "./structuredResources";
const resource={id:"object",paperId:"paper",kind:"structuredReading",sourceUri:"source://library/paper/object",title:"阅读",revision:1,content:null,reviewBaseline:null,pendingFieldIds:[],reviewedFieldIds:[]};
describe("stable structured resources",()=>{
  it("accepts precreated empty objects and rejects a mismatched source parent",()=>{
    expect(decodeStructuredResource({...resource,revision:0}).id).toBe("object");
    expect(()=>decodeStructuredResource({...resource,sourceUri:"source://library/other/object"})).toThrow("身份");
    expect(decodeStructuredResource({...resource,paperId:undefined,kind:"readingTemplate",sourceUri:`source://agents/skills/edit-structured-resources/assets/reading/object.json`}).kind).toBe("readingTemplate");
  });
  it("requires a matching durable application receipt",()=>{
    expect(()=>decodeStructuredWriteResult({status:"applied",resource,errors:[],receipt:{requestId:"request",resourceId:"another",revision:1,contentHash:"hash"}})).toThrow("回执身份");
  });
  it("preserves optional pure validation origins without changing legacy issues or absent fields",()=>{
    const errors=[{path:"$.name",code:"invalid_input",message:"原拒绝消息"}];
    const legacy={status:"invalid",resource,errors};
    expect(decodeStructuredWriteResult(legacy)).toEqual(legacy);
    expect(decodeStructuredWriteResult(legacy)).not.toHaveProperty("validationOrigin");
    const validationOrigin={requestId:"core-request",packageKey:"a".repeat(64),instanceId:"instance",nativeRequestId:"native-request"};
    expect(decodeStructuredWriteResult({...legacy,validationOrigin})).toEqual({...legacy,validationOrigin});
  });
  it.each([null,[],{},"origin",{requestId:"request"},
    {requestId:"request",packageKey:"key",instanceId:7,nativeRequestId:"native"},
    {requestId:"request",packageKey:"key",instanceId:"instance",nativeRequestId:"native",extra:"private"},
    {requestId:"request",packageKey:"key",instanceId:"instance",nativeRequestId:"native",[Symbol("unknown")]:"private"},
  ])("rejects malformed or extended validation origin shapes (%#)",validationOrigin=>{
    expect(()=>decodeStructuredWriteResult({status:"invalid",resource,errors:[],validationOrigin})).toThrow();
  });
  it("uses stable IDs to edit fields while retaining source statements",()=>{
    const content={kind:"paper_overview_unit_v1",fields:[{field:"question",statements:[{id:"q",text:"old",evidenceItemIds:["e1"],evidenceQuotes:[{evidenceItemId:"e1",quote:"source"}]}]}]};
    const changed=replaceStructuredFieldText(content,"question","new") as typeof content;
    expect(changed.fields[0]?.statements[0]).toEqual({...content.fields[0]?.statements[0],text:"new"});
    expect(content.fields[0]?.statements[0]?.text).toBe("old");
    expect(structuredResourceFields(changed).map(field=>field.id)).toEqual(["question"]);
  });
});

it("includes coverage and field order as independent stable review ranges",()=>{
  const before={kind:"paper_portrait_v1",schemaVersion:1,coverage:"old",claims:[{id:"one",label:"One",description:"a"},{id:"two",label:"Two",description:"b"}]};
  const after={...before,coverage:"new",claims:[...before.claims].reverse()};
  const old=structuredResourceDiffFields(before),next=structuredResourceDiffFields(after);
  expect(next.filter(field=>JSON.stringify(field.value)!==JSON.stringify(old.find(previous=>previous.id===field.id)?.value)).map(field=>field.id)).toEqual(["$metadata","$order"]);
});

it("exposes retained reading fields separately from active fields and metadata", () => {
  const retained = {field: "old", statements: [{id: "old-note", text: "kept body", evidenceItemIds: []}]};
  const content = {kind: "paper_overview_unit_v1", schemaVersion: 1, fields: [], retainedFields: [retained]};
  expect(structuredResourceFields(content)).toEqual([]);
  const chunks = structuredResourceDiffFields(content);
  expect(chunks.find(field => field.id === "$retained:old")).toMatchObject({text: "kept body", value: retained});
  expect(chunks.find(field => field.id === "$metadata")?.value).not.toHaveProperty("retainedFields");
});
