import { AgentSubmissionDecodeError,decodeAgentNoteQueueScope,decodeAgentNoteQueueResponse,
  decodeAgentNoteQueueEditRequest,decodeAgentNoteQueuePrepareRequest,decodeAgentNoteQueuePreview,
  decodeAgentNoteQueueCancelRequest,decodeAgentQueueConfirmation,decodeAgentFrozenNoteRecord,
  decodeAgentNoteQueueRecoveryRequest,decodeAgentNoteQueueRecoveryPage,decodeAgentStartResponse,
  decodeAgentNoteContextPreview,decodeAgentReadingNoteContextPreview,
  type AgentNoteQueueScope,type AgentNoteQueueResponse,type AgentNoteQueueEditRequest,
  type AgentNoteQueuePrepareRequest,type AgentNoteQueuePreview,type AgentNoteQueueCancelRequest,
  type AgentNoteQueueRecoveryRequest,type AgentNoteQueueRecoveryPage,type AgentQueueConfirmation,
  type AgentFrozenNoteRecord,type AgentExecutionMode,type AgentStartResponse,
} from "@research-assistant/core/agent";
import type {AgentMetadataInvoke} from "./index";
import {createAgentNoteSubmissionGateway} from "./noteSubmission";
import {createAgentReadingNoteSubmissionGateway} from "./readingNoteSubmission";
import {freezeQueueEditRequest,inspectQueueEdit,type AgentQueueEditInspection} from "./queueEditInspection";

export interface AgentNoteQueueGateway {
  read(scope:AgentNoteQueueScope):Promise<AgentNoteQueueResponse>;
  edit(request:AgentNoteQueueEditRequest):Promise<AgentNoteQueueResponse>;
  prepare(request:AgentNoteQueuePrepareRequest):Promise<AgentNoteQueuePreview>;
  recover(scope:AgentNoteQueueScope):Promise<AgentNoteQueuePreview|null>;
  cancel(request:AgentNoteQueueCancelRequest):Promise<AgentNoteQueueResponse>;
  start(scope:AgentNoteQueueScope,record:AgentFrozenNoteRecord,queue:AgentQueueConfirmation,mode:AgentExecutionMode):Promise<AgentStartResponse>;
  restore(scope:AgentNoteQueueScope,requestId:string):Promise<AgentFrozenNoteRecord>;
  list(request:AgentNoteQueueRecoveryRequest):Promise<AgentNoteQueueRecoveryPage>;
}
function fail():never {throw new AgentSubmissionDecodeError();}
function match(actual:AgentNoteQueueScope,expected:AgentNoteQueueScope):void {
  if(actual.conversationId!==expected.conversationId||actual.scope.kind!==expected.scope.kind||actual.scope.resourceId!==expected.scope.resourceId)fail();
}
/** Every request is decoded into an owned value before IPC. Writes are never retried here. */
export function createAgentNoteQueueGateway(invoke:AgentMetadataInvoke):AgentNoteQueueGateway & AgentQueueEditInspection<AgentNoteQueueEditRequest> {
  const notes=createAgentNoteSubmissionGateway(invoke),reading=createAgentReadingNoteSubmissionGateway(invoke);
  return {
    async read(input) {
      const request=decodeAgentNoteQueueScope(input),result=decodeAgentNoteQueueResponse(await invoke("agent_read_note_input_queue",{request:structuredClone(request)}));
      match(result,request);return result;
    },
    async edit(input) {
      const request=freezeQueueEditRequest(input,decodeAgentNoteQueueEditRequest),result=decodeAgentNoteQueueResponse(await invoke("agent_edit_note_input_queue",{request:structuredClone(request)}));
      match(result,request);if(result.revision!==request.expectedRevision+1)return fail();return result;
    },
    inspectEdit: input => inspectQueueEdit(invoke,"agent_read_note_input_queue_edit_status",input,decodeAgentNoteQueueEditRequest),
    async prepare(input) {
      const request=decodeAgentNoteQueuePrepareRequest(input),submission=request.submission;
      const expected:AgentNoteQueueScope={conversationId:submission.request.conversationId,scope:{kind:submission.kind,resourceId:submission.kind==="note"?submission.request.context.pageId:submission.request.context.readingNoteId}};
      const result=decodeAgentNoteQueuePreview(await invoke("agent_prepare_note_queue_preview",{request:structuredClone(request)}));
      match(result.queue,expected);
      if(result.inputId!==request.inputId||result.record.requestId!==submission.request.requestId||result.record.input.text!==submission.request.text||result.queue.revision!==request.expectedRevision+1)return fail();
      const model=submission.request.model;
      if(model&&(result.record.input.model.providerId!==model.providerId||result.record.input.model.modelId!==model.modelId||result.record.input.reasoningEffort!==(model.reasoningEffort??null)))return fail();
      const source={schemaVersion:1 as const,source:result.record.input.context[0]};
      if(submission.kind==="note")decodeAgentNoteContextPreview(source,submission.request.context);
      else decodeAgentReadingNoteContextPreview(source,submission.request.context);
      return result;
    },
    async recover(input) {
      const request=decodeAgentNoteQueueScope(input),raw=await invoke("agent_read_pending_note_queue_preview",{request:structuredClone(request)});
      if(raw===null)return null;
      const result=decodeAgentNoteQueuePreview(raw);match(result.queue,request);return result;
    },
    async cancel(input) {
      const request=decodeAgentNoteQueueCancelRequest(input),result=decodeAgentNoteQueueResponse(await invoke("agent_cancel_note_queue_preview",{request:structuredClone(request)}));
      match(result,request);
      if(result.revision!==request.expectedRevision+1||result.preparingInputId!==null||!result.paused||!result.inputs.some(input=>input.inputId===request.inputId))return fail();
      return result;
    },
    async start(input,value,confirmation,mode) {
      const scope=decodeAgentNoteQueueScope(input),record=decodeAgentFrozenNoteRecord(value,scope),queue=decodeAgentQueueConfirmation(confirmation);
      if(mode!=="deepSeekNonThinking"&&mode!=="chatGptDefault")return fail();
      const result=decodeAgentStartResponse(await invoke("agent_start_note_queued_submission",{request:{...scope,requestId:record.requestId,contextSnapshotId:record.contextSnapshotId,model:{...record.input.model},queue,mode}}));
      if(result.conversationId!==scope.conversationId||result.requestId!==record.requestId||result.turnId!==record.turnId)return fail();return result;
    },
    async restore(input,requestId) {
      const scope=decodeAgentNoteQueueScope(input);
      const record=scope.scope.kind==="note"
        ?await notes.restore({conversationId:scope.conversationId,pageId:scope.scope.resourceId,requestId})
        :await reading.restore({conversationId:scope.conversationId,readingNoteId:scope.scope.resourceId,requestId});
      return decodeAgentFrozenNoteRecord({conversationId:record.conversationId,requestId:record.requestId,turnId:record.turnId,contextSnapshotId:record.contextSnapshotId,input:record.input},scope);
    },
    async list(input) {
      const request=decodeAgentNoteQueueRecoveryRequest(input),result=decodeAgentNoteQueueRecoveryPage(await invoke("agent_list_unstarted_note_queue_admissions",{request:structuredClone(request)}));
      match(result,request);
      if(result.items.length>request.limit)return fail();
      let previous=request.after;
      for(const item of result.items){if(previous&&item.requestId<=previous)return fail();previous=item.requestId;}
      if(result.nextCursor!==null&&result.items.length!==request.limit)return fail();return result;
    },
  };
}
