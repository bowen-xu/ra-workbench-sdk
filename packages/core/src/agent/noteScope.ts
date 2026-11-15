import {AgentSubmissionDecodeError} from "./submission";

/** Authorization scope shared by saved-note operations; not a frozen content snapshot. */
export interface AgentNoteScope {
  readonly conversationId:string;
  readonly scope:{readonly kind:"note"|"readingNote";readonly resourceId:string};
}
function fields(value:unknown,keys:readonly string[]):Record<string,unknown>{
  if(!value||typeof value!=="object"||Array.isArray(value))throw new AgentSubmissionDecodeError();
  const row=value as Record<string,unknown>;
  if(Object.keys(row).length!==keys.length||keys.some(key=>!Object.hasOwn(row,key)))throw new AgentSubmissionDecodeError();return row;
}
function id(value:unknown):string {
  if(typeof value!=="string"||!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)||value==="00000000-0000-0000-0000-000000000000")throw new AgentSubmissionDecodeError();
  return value.toLowerCase();
}
export function decodeAgentNoteScope(value:unknown):AgentNoteScope {
  const row=fields(value,["conversationId","scope"]),scope=fields(row.scope,["kind","resourceId"]);
  if(scope.kind!=="note"&&scope.kind!=="readingNote")throw new AgentSubmissionDecodeError();
  return {conversationId:id(row.conversationId),scope:{kind:scope.kind,resourceId:id(scope.resourceId)}};
}
