import {decodeRecoveryRequest,decodeRecoveryPage} from "./recoveryDecoding";

export interface AgentNoteRecoveryRequest {
  readonly conversationId:string;
  readonly pageId:string;
  readonly after:string|null;
  readonly limit:number;
}
export interface AgentNoteRecoveryCandidate {
  readonly requestId:string;
  readonly turnId:string;
  readonly messageExcerpt:string;
  readonly createdAt:string;
}
export interface AgentNoteRecoveryPage {
  readonly schemaVersion:1;
  readonly conversationId:string;
  readonly pageId:string;
  readonly items:readonly AgentNoteRecoveryCandidate[];
  readonly nextCursor:string|null;
}
export function decodeAgentNoteRecoveryRequest(value:unknown):AgentNoteRecoveryRequest {
  const {resourceId,...fields}=decodeRecoveryRequest(value,"pageId");
  return {...fields,pageId:resourceId};
}
export function decodeAgentNoteRecoveryPage(value:unknown,scope:AgentNoteRecoveryRequest):AgentNoteRecoveryPage {
  const {resourceId,...fields}=decodeRecoveryPage(value,scope,"pageId");
  return {...fields,pageId:resourceId};
}
