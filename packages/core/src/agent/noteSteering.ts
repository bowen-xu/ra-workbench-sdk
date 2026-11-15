import {decodeAgentUserInput,type AgentUserInput} from "./userInput";
import {AgentSubmissionDecodeError,decodeAgentQueuedText,decodeAgentSteerResponse,type AgentSteerResponse} from "./submission";
import {decodeAgentNoteScope,type AgentNoteScope} from "./noteScope";

export interface AgentNoteSteeringScope extends AgentNoteScope {readonly turnId:string;}
export interface AgentNoteSteerRequest extends AgentNoteSteeringScope {readonly inputId:string;readonly text:string;readonly userInput?:readonly AgentUserInput[];}
export type AgentNoteSteerResponse=AgentSteerResponse;
export interface AgentNoteSteeringRecovery extends AgentNoteSteeringScope {
  readonly schemaVersion:1;
  readonly inputs:readonly {readonly inputId:string;readonly text:string;readonly userInput?:readonly AgentUserInput[]}[];
}
function fail():never {throw new AgentSubmissionDecodeError();}
function row(value:unknown,keys:readonly string[]):Record<string,unknown>{
  if(!value||typeof value!=="object"||Array.isArray(value))return fail();
  const r=value as Record<string,unknown>;
  if(Object.keys(r).length!==keys.length||keys.some(k=>!Object.hasOwn(r,k)))return fail();return r;
}
function uuid(value:unknown):string {
  if(typeof value!=="string"||!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)||value==="00000000-0000-0000-0000-000000000000")return fail();
  return value.toLowerCase();
}
export function decodeAgentNoteSteeringScope(value:unknown):AgentNoteSteeringScope {
  const r=row(value,["conversationId","scope","turnId"]);
  return {...decodeAgentNoteScope({conversationId:r.conversationId,scope:r.scope}),turnId:uuid(r.turnId)};
}
export function decodeAgentNoteSteerRequest(value:unknown):AgentNoteSteerRequest {
  const r=row(value,["conversationId","scope","turnId","inputId","text", ...((value as {userInput?: unknown}).userInput !== undefined ? ["userInput"] : [])]);
  return {...decodeAgentNoteSteeringScope({conversationId:r.conversationId,scope:r.scope,turnId:r.turnId}),inputId:uuid(r.inputId),text:decodeAgentQueuedText(r.text),...(r.userInput!==undefined?{userInput:decodeAgentUserInput(r.userInput,decodeAgentQueuedText(r.text))}:{})};
}
export function decodeAgentNoteSteerResponse(value:unknown):AgentNoteSteerResponse {
  const r=decodeAgentSteerResponse(value);
  return {...r,conversationId:uuid(r.conversationId),turnId:uuid(r.turnId),inputId:uuid(r.inputId)};
}
export function decodeAgentNoteSteeringRecovery(value:unknown):AgentNoteSteeringRecovery {
  const r=row(value,["schemaVersion","conversationId","scope","turnId","inputs"]);
  if(r.schemaVersion!==1||!Array.isArray(r.inputs)||r.inputs.length>64)return fail();
  const scope=decodeAgentNoteSteeringScope({conversationId:r.conversationId,scope:r.scope,turnId:r.turnId});
  const seen=new Set<string>();
  const inputs=r.inputs.map(value=>{
    const item=row(value,["inputId","text",...((value as {userInput?:unknown}).userInput!==undefined?["userInput"]:[])]),inputId=uuid(item.inputId);
    if(seen.has(inputId))return fail();seen.add(inputId);return {inputId,text:decodeAgentQueuedText(item.text),...(item.userInput!==undefined?{userInput:decodeAgentUserInput(item.userInput,decodeAgentQueuedText(item.text))}:{})};
  });
  return {schemaVersion:1,...scope,inputs};
}
