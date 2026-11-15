import { AgentSubmissionDecodeError, decodeAgentQueueCommand, decodeAgentQueueState,
  type AgentQueueCommand, type AgentQueueState, type AgentSubmissionInput } from "./submission";
import { decodeAgentNotePrepareRequest, decodeAgentNoteSubmissionPreview, type AgentNotePrepareRequest } from "./noteSubmission";
import { decodeAgentReadingNotePrepareRequest, decodeAgentReadingNoteSubmissionPreview, type AgentReadingNotePrepareRequest } from "./readingNoteSubmission";

import {decodeAgentNoteScope as decodeAgentNoteQueueScope,type AgentNoteScope} from "./noteScope";
export {decodeAgentNoteQueueScope};
export type AgentNoteQueueScope=AgentNoteScope;
export interface AgentNoteQueueResponse extends AgentNoteQueueScope,AgentQueueState {}
export interface AgentNoteQueueEditRequest extends AgentNoteQueueScope,AgentQueueCommand {readonly expectedEpoch?:string}
export type AgentNoteQueueSubmission = {readonly kind:"note";readonly request:AgentNotePrepareRequest}
  | {readonly kind:"readingNote";readonly request:AgentReadingNotePrepareRequest};
export interface AgentQueueConfirmation {readonly inputId:string;readonly expectedRevision:number;}
export interface AgentNoteQueuePrepareRequest extends AgentQueueConfirmation {readonly submission:AgentNoteQueueSubmission;}
export interface AgentFrozenNoteRecord {
  readonly conversationId:string;readonly requestId:string;readonly turnId:string;
  readonly contextSnapshotId:string;readonly input:AgentSubmissionInput;
}
export interface AgentNoteQueuePreview {
  readonly schemaVersion:1;readonly inputId:string;readonly scope:AgentNoteQueueScope["scope"];
  readonly record:AgentFrozenNoteRecord;readonly queue:AgentNoteQueueResponse;
}
export interface AgentNoteQueueCancelRequest extends AgentNoteQueueScope,AgentQueueConfirmation {
  readonly requestId:string;readonly previewRequestId:string;
}
function fail():never {throw new AgentSubmissionDecodeError();}
function row(value:unknown,keys:readonly string[]):Record<string,unknown> {
  if(!value||typeof value!=="object"||Array.isArray(value))return fail();
  const r=value as Record<string,unknown>;
  if(Object.keys(r).length!==keys.length||keys.some(k=>!Object.hasOwn(r,k)))return fail();
  return r;
}
function id(value:unknown):string {
  if(typeof value!=="string"||!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)||value==="00000000-0000-0000-0000-000000000000")return fail();
  return value.toLowerCase();
}
export function decodeAgentQueueConfirmation(value:unknown):AgentQueueConfirmation {
  const r=row(value,["inputId","expectedRevision"]);
  if(typeof r.expectedRevision!=="number"||!Number.isSafeInteger(r.expectedRevision)||r.expectedRevision<0||r.expectedRevision>=Number.MAX_SAFE_INTEGER)return fail();
  return {inputId:id(r.inputId),expectedRevision:r.expectedRevision};
}
export function decodeAgentNoteQueueResponse(value:unknown):AgentNoteQueueResponse {
  const r=row(value,["schemaVersion","conversationId","scope","revision","paused","preparingInputId","inputs"]);
  const {scope,...state}=r;
  return {...decodeAgentQueueState(state),...decodeAgentNoteQueueScope({conversationId:r.conversationId,scope})};
}
export function decodeAgentNoteQueueEditRequest(value:unknown):AgentNoteQueueEditRequest {
  const guarded=!!value&&typeof value==="object"&&Object.hasOwn(value,"expectedEpoch");
  const r=row(value,["conversationId","scope","requestId","expectedRevision","edit",...(guarded?["expectedEpoch"]:[])]);
  return {...decodeAgentNoteQueueScope({conversationId:r.conversationId,scope:r.scope}),
    ...decodeAgentQueueCommand({requestId:r.requestId,expectedRevision:r.expectedRevision,edit:r.edit}),...(guarded?{expectedEpoch:id(r.expectedEpoch)}:{})};
}
export function decodeAgentNoteQueuePrepareRequest(value:unknown):AgentNoteQueuePrepareRequest {
  const r=row(value,["inputId","expectedRevision","submission"]),s=row(r.submission,["kind","request"]);
  const confirmation=decodeAgentQueueConfirmation({inputId:r.inputId,expectedRevision:r.expectedRevision});
  if(s.kind==="note")return {...confirmation,submission:{kind:"note",request:decodeAgentNotePrepareRequest(s.request)}};
  if(s.kind==="readingNote")return {...confirmation,submission:{kind:"readingNote",request:decodeAgentReadingNotePrepareRequest(s.request)}};
  return fail();
}
export function decodeAgentFrozenNoteRecord(value:unknown,scope:AgentNoteQueueScope):AgentFrozenNoteRecord {
  const r=row(value,["conversationId","requestId","turnId","contextSnapshotId","input"]);
  const common={...r,schemaVersion:1};
  const preview=scope.scope.kind==="note"
    ?decodeAgentNoteSubmissionPreview({...common,pageId:scope.scope.resourceId})
    :decodeAgentReadingNoteSubmissionPreview({...common,readingNoteId:scope.scope.resourceId});
  if(preview.conversationId!==scope.conversationId)return fail();
  return {conversationId:preview.conversationId,requestId:preview.requestId,turnId:preview.turnId,contextSnapshotId:preview.contextSnapshotId,input:preview.input};
}
export function decodeAgentNoteQueuePreview(value:unknown):AgentNoteQueuePreview {
  const r=row(value,["schemaVersion","inputId","scope","record","queue"]);
  if(r.schemaVersion!==1)return fail();
  const queue=decodeAgentNoteQueueResponse(r.queue),scope=decodeAgentNoteQueueScope({conversationId:queue.conversationId,scope:r.scope});
  const inputId=id(r.inputId),record=decodeAgentFrozenNoteRecord(r.record,scope);
  if(scope.scope.kind!==queue.scope.kind||scope.scope.resourceId!==queue.scope.resourceId||queue.preparingInputId!==inputId||record.input.text!==queue.inputs.find(input=>input.inputId===inputId)?.text)return fail();
  return {schemaVersion:1,inputId,scope:scope.scope,record,queue};
}
export function decodeAgentNoteQueueCancelRequest(value:unknown):AgentNoteQueueCancelRequest {
  const r=row(value,["conversationId","scope","requestId","expectedRevision","inputId","previewRequestId"]);
  return {...decodeAgentNoteQueueScope({conversationId:r.conversationId,scope:r.scope}),
    ...decodeAgentQueueConfirmation({inputId:r.inputId,expectedRevision:r.expectedRevision}),requestId:id(r.requestId),previewRequestId:id(r.previewRequestId)};
}

export interface AgentNoteQueueRecoveryRequest extends AgentNoteQueueScope {readonly after:string|null;readonly limit:number;}
export interface AgentNoteQueueAdmission {
  readonly requestId:string;readonly turnId:string;readonly createdAt:string;readonly messageExcerpt:string;
  readonly queue:AgentQueueConfirmation;
}
export interface AgentNoteQueueRecoveryPage extends AgentNoteQueueScope {
  readonly schemaVersion:1;readonly items:readonly AgentNoteQueueAdmission[];readonly nextCursor:string|null;
}
export function decodeAgentNoteQueueRecoveryRequest(value:unknown):AgentNoteQueueRecoveryRequest {
  const r=row(value,["conversationId","scope","after","limit"]);
  if(typeof r.limit!=="number"||!Number.isInteger(r.limit)||r.limit<1||r.limit>64)return fail();
  return {...decodeAgentNoteQueueScope({conversationId:r.conversationId,scope:r.scope}),after:r.after===null?null:id(r.after),limit:r.limit};
}
export function decodeAgentNoteQueueRecoveryPage(value:unknown):AgentNoteQueueRecoveryPage {
  const r=row(value,["schemaVersion","conversationId","scope","items","nextCursor"]);
  if(r.schemaVersion!==1||!Array.isArray(r.items)||r.items.length>64)return fail();
  const scope=decodeAgentNoteQueueScope({conversationId:r.conversationId,scope:r.scope});
  const ids=new Set<string>();
  const items=r.items.map(value=>{
    const item=decodeAgentNoteQueueAdmission(value);
    if(ids.has(item.requestId))return fail();
    ids.add(item.requestId);return item;
  });
  const nextCursor=r.nextCursor===null?null:id(r.nextCursor);
  if(nextCursor!==null&&nextCursor!==items.at(-1)?.requestId)return fail();
  return {schemaVersion:1,...scope,items,nextCursor};
}

export function decodeAgentNoteQueueAdmission(value:unknown):AgentNoteQueueAdmission {
  const item=row(value,["requestId","turnId","createdAt","messageExcerpt","queue"]);
  if(typeof item.createdAt!=="string"||!Number.isFinite(Date.parse(item.createdAt))||typeof item.messageExcerpt!=="string"||[...item.messageExcerpt].length>200)return fail();
  return {requestId:id(item.requestId),turnId:id(item.turnId),createdAt:item.createdAt,messageExcerpt:item.messageExcerpt,queue:decodeAgentQueueConfirmation(item.queue)};
}
