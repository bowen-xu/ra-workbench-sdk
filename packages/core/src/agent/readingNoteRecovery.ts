import {decodeRecoveryRequest,decodeRecoveryPage} from "./recoveryDecoding";

export interface AgentReadingNoteRecoveryRequest {
  readonly conversationId:string;
  readonly readingNoteId:string;
  readonly after:string|null;
  readonly limit:number;
}
export interface AgentReadingNoteRecoveryCandidate {
  readonly requestId:string;
  readonly turnId:string;
  readonly messageExcerpt:string;
  readonly createdAt:string;
}
export interface AgentReadingNoteRecoveryPage {
  readonly schemaVersion:1;
  readonly conversationId:string;
  readonly readingNoteId:string;
  readonly items:readonly AgentReadingNoteRecoveryCandidate[];
  readonly nextCursor:string|null;
}
export function decodeAgentReadingNoteRecoveryRequest(value:unknown):AgentReadingNoteRecoveryRequest {
  const {resourceId,...fields}=decodeRecoveryRequest(value,"readingNoteId");
  return {...fields,readingNoteId:resourceId};
}
export function decodeAgentReadingNoteRecoveryPage(value:unknown,scope:AgentReadingNoteRecoveryRequest):AgentReadingNoteRecoveryPage {
  const {resourceId,...fields}=decodeRecoveryPage(value,scope,"readingNoteId");
  return {...fields,readingNoteId:resourceId};
}
