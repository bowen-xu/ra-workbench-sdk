import { AgentNoteSubmissionDecodeError } from "./noteSubmission";

function fail():never {throw new AgentNoteSubmissionDecodeError();}
function row(value:unknown,keys:readonly string[]):Record<string,unknown> {
  if(!value || typeof value!=="object" || Array.isArray(value)) return fail();
  const data=value as Record<string,unknown>;
  if(Object.keys(data).length!==keys.length || keys.some(key=>!Object.hasOwn(data,key))) return fail();
  return data;
}
function uuid(value:unknown):string {
  if(typeof value!=="string" || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)
    || value==="00000000-0000-0000-0000-000000000000") return fail();
  return value.toLowerCase();
}
export function decodeRecoveryRequest(value:unknown,key:"pageId"|"readingNoteId") {
  const data=row(value,["conversationId",key,"after","limit"]);
  if(typeof data.limit!=="number" || !Number.isInteger(data.limit) || data.limit<1 || data.limit>64) return fail();
  return {conversationId:uuid(data.conversationId),resourceId:uuid(data[key]),after:data.after===null?null:uuid(data.after),limit:data.limit};
}
/** Candidates disclose only bounded metadata. Restoring and starting are separate checks. */
export function decodeRecoveryPage(value:unknown,scope:unknown,key:"pageId"|"readingNoteId") {
  const expected=decodeRecoveryRequest(scope,key);
  const data=row(value,["schemaVersion","conversationId",key,"items","nextCursor"]);
  if(data.schemaVersion!==1 || uuid(data.conversationId)!==expected.conversationId || uuid(data[key])!==expected.resourceId
    || !Array.isArray(data.items) || data.items.length>expected.limit) return fail();
  let previous=expected.after;
  const turns=new Set<string>();
  const items=data.items.map(value=>{
    const item=row(value,["requestId","turnId","messageExcerpt","createdAt"]);
    const requestId=uuid(item.requestId),turnId=uuid(item.turnId);
    if((previous!==null && requestId<=previous) || turns.has(turnId) || typeof item.messageExcerpt!=="string"
      || [...item.messageExcerpt].length>200 || item.messageExcerpt.includes("\0")
      || typeof item.createdAt!=="string" || item.createdAt.length>40 || !Number.isFinite(Date.parse(item.createdAt))) return fail();
    previous=requestId;turns.add(turnId);
    return {requestId,turnId,messageExcerpt:item.messageExcerpt,createdAt:item.createdAt};
  });
  const nextCursor=data.nextCursor===null?null:uuid(data.nextCursor);
  const required=items.length===expected.limit ? items.at(-1)?.requestId : null;
  if(nextCursor!==required) return fail();
  return {schemaVersion:1 as const,conversationId:expected.conversationId,resourceId:expected.resourceId,items,nextCursor};
}
