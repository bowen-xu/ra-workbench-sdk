import {expect,it,vi} from "vitest";
import {decodeAgentNoteQueueScope,decodeAgentNoteQueuePrepareRequest,decodeAgentNoteQueueResponse,
  type AgentNoteQueueScope,type AgentNoteQueuePreview,type AgentNoteQueuePrepareRequest} from "@research-assistant/core/agent";
import {createAgentNoteQueueGateway} from "./noteQueue";

const conversationId="a1111111-1111-4111-8111-111111111111",requestId="b1111111-1111-4111-8111-111111111111";
const resourceId="c1111111-1111-4111-8111-111111111111",turnId="d1111111-1111-4111-8111-111111111111";
const contextSnapshotId="e1111111-1111-4111-8111-111111111111",inputId="f1111111-1111-4111-8111-111111111111";
const model={providerId:"deepseek",modelId:"deepseek-v4-pro",revision:null};
function fixture(kind:AgentNoteQueueScope["scope"]["kind"]) {
  const scope:AgentNoteQueueScope={conversationId,scope:{kind,resourceId}};
  const base={conversationId,requestId,text:"Explain queued evidence",model:{providerId:model.providerId,modelId:model.modelId,reasoningEffort:null}};
  const submission:AgentNoteQueuePrepareRequest["submission"]=kind==="note"
    ?{kind,request:{...base,context:{pageId:resourceId,expectedRevision:3,blockId:null}}}
    :{kind,request:{...base,context:{readingNoteId:resourceId,expectedRevision:3}}};
  const source=kind==="note"?{
    kind:"note" as const,sourceId:`note:${"a".repeat(64)}`,resourceId,revision:`revision:3:sha256:${"b".repeat(64)}`,
    anchor:JSON.stringify({schemaVersion:1,pageId:resourceId,pageRevision:3,blockId:null}),
    text:JSON.stringify({schemaVersion:1,pageId:resourceId,pageRevision:3,title:"Synthetic",blocks:[{
      id:"paragraph",type:"paragraph",props:{},content:{kind:"inline",items:[{type:"text",text:"Saved note",styles:[]}]},children:[],
    }]}),
  }:{
    kind:"note" as const,sourceId:`reading-note:${resourceId}`,resourceId,revision:`revision:3:sha256:${"b".repeat(64)}`,
    anchor:JSON.stringify({schemaVersion:1,readingNoteId:resourceId,noteRevision:3,sourceAnchorId:null,paperId:"paper",attachmentId:"pdf",contentSha256:"a".repeat(64),pageIndex:2,locatorVersion:1}),
    text:JSON.stringify({schemaVersion:1,readingNoteId:resourceId,noteRevision:3,noteType:"annotation",content:{body:"Saved annotation"},source:{
      anchorId:null,paperId:"paper",paperTitle:"Synthetic",attachmentId:"pdf",contentSha256:"a".repeat(64),pageIndex:2,pageLabel:null,rects:[],quoteExact:"Retained quote",quotePrefix:"",quoteSuffix:"",selector:null,locatorVersion:1,
    }}),
  };
  const request:AgentNoteQueuePrepareRequest={inputId,expectedRevision:4,submission};
  const preview:AgentNoteQueuePreview={schemaVersion:1,inputId,scope:scope.scope,
    record:{conversationId,requestId,turnId,contextSnapshotId,input:{text:base.text,model,reasoningEffort:null,context:[source]}},
    queue:{schemaVersion:1,...scope,revision:5,paused:false,preparingInputId:inputId,inputs:[{inputId,text:base.text}]}};
  return {scope,request,preview};
}
for(const kind of ["note","readingNote"] as const){
  it(`uses only scoped queue IPC for ${kind} preparation, cancellation and start`,async()=>{
    const {scope,request,preview}=fixture(kind),invoke=vi.fn().mockResolvedValue(preview),gateway=createAgentNoteQueueGateway(invoke);
    expect(await gateway.prepare(request)).toEqual(preview);
    expect(invoke).toHaveBeenLastCalledWith("agent_prepare_note_queue_preview",{request});
    expect(await gateway.recover(scope)).toEqual(preview);
    const confirmation={inputId,expectedRevision:5};
    const cancel={...scope,...confirmation,requestId:turnId,previewRequestId:requestId};
    const canceled={...preview.queue,revision:6,preparingInputId:null,paused:true};
    invoke.mockResolvedValue(canceled);expect(await gateway.cancel(cancel)).toEqual(canceled);
    expect(invoke).toHaveBeenLastCalledWith("agent_cancel_note_queue_preview",{request:cancel});
    const started={schemaVersion:1,conversationId,requestId,turnId,alreadyStarted:true,outcome:"canceled"};
    invoke.mockResolvedValue(started);expect(await gateway.start(scope,preview.record,confirmation,"deepSeekNonThinking")).toEqual(started);
    expect(invoke).toHaveBeenLastCalledWith("agent_start_note_queued_submission",{request:{...scope,requestId,contextSnapshotId,model,queue:confirmation,mode:"deepSeekNonThinking"}});
    invoke.mockResolvedValue({...started,turnId:inputId});
    await expect(gateway.start(scope,preview.record,confirmation,"deepSeekNonThinking")).rejects.toThrow();
  });
  it(`restores ${kind} original frozen data through its typed receipt`,async()=>{
    const {scope,preview}=fixture(kind),field=kind==="note"?"pageId":"readingNoteId";
    const invoke=vi.fn().mockResolvedValue({schemaVersion:1,...preview.record,[field]:resourceId});
    expect(await createAgentNoteQueueGateway(invoke).restore(scope,requestId)).toEqual(preview.record);
    expect(invoke).toHaveBeenCalledExactlyOnceWith(kind==="note"?"agent_restore_note_submission":"agent_restore_reading_note_submission",{request:{conversationId,requestId,[field]:resourceId}});
  });
  it(`rejects changed ${kind} queue heads, bindings, models and source revisions`,async()=>{
    const {scope,request,preview}=fixture(kind);
    const changes=[
      {...preview,scope:{...scope.scope,resourceId:turnId}},
      {...preview,inputId:turnId},
      {...preview,queue:{...preview.queue,revision:6}},
      {...preview,record:{...preview.record,requestId:turnId}},
      {...preview,record:{...preview.record,input:{...preview.record.input,model:{...model,modelId:"changed"}}}},
      {...preview,queue:{...preview.queue,inputs:[{inputId,text:"substituted"}]}},
    ];
    for(const value of changes)await expect(createAgentNoteQueueGateway(vi.fn().mockResolvedValue(value)).prepare(request)).rejects.toThrow();
    const changed=structuredClone(request);Object.assign(changed.submission.request.context,{expectedRevision:4});
    await expect(createAgentNoteQueueGateway(vi.fn().mockResolvedValue(preview)).prepare(changed)).rejects.toThrow();
    const wrongKind={...scope,scope:{...scope.scope,kind:kind==="note"?"readingNote" as const:"note" as const}};
    await expect(createAgentNoteQueueGateway(vi.fn().mockResolvedValue(preview)).recover(wrongKind)).rejects.toThrow();
  });
  it(`owns ${kind} request and transport values independently across awaits`,async()=>{
    const {request,preview}=fixture(kind);let finish!:(value:unknown)=>void;
    const invoke=vi.fn((_command,args)=>{
      args.request.expectedRevision=99;args.request.submission.request.context.expectedRevision=99;
      return new Promise(done=>{finish=done;});
    });
    const pending=createAgentNoteQueueGateway(invoke).prepare(request);
    const mutable=JSON.parse(JSON.stringify(request));
    // The original caller-owned object can also change before the native reply.
    Object.assign(request,{inputId:turnId});Object.assign(request.submission.request.context,{expectedRevision:9});
    finish(preview);expect(await pending).toEqual(preview);expect(mutable.inputId).toBe(inputId);
  });
}
it("enforces strict queue authority, UTF-8 limits and safe revisions before invocation",async()=>{
  const {scope,request}=fixture("note"),invoke=vi.fn(),gateway=createAgentNoteQueueGateway(invoke);
  expect(()=>decodeAgentNoteQueueScope({...scope,tools:[]})).toThrow();
  expect(()=>decodeAgentNoteQueueScope({...scope,scope:{...scope.scope,kind:"paper"}})).toThrow();
  expect(()=>decodeAgentNoteQueuePrepareRequest({...request,expectedRevision:Number.MAX_SAFE_INTEGER})).toThrow();
  for(const edit of [{type:"add",inputId,text:"界".repeat(21846)},{type:"add",inputId,text:"\ud800"},{type:"add",inputId,text:"x",allowWrite:true}]){
    await expect(gateway.edit({...scope,requestId,expectedRevision:0,edit} as never)).rejects.toThrow();
  }
  expect(invoke).not.toHaveBeenCalled();
});
it("keeps reads and edits scoped and verifies exact edit revision even with mutated transport arguments",async()=>{
  const {scope,preview}=fixture("note"),state={...preview.queue,preparingInputId:null};
  const invoke=vi.fn((_command,args)=>{args.request.scope.kind="readingNote";return Promise.resolve(state);});
  const gateway=createAgentNoteQueueGateway(invoke);
  expect(await gateway.read(scope)).toEqual(state);
  expect(await gateway.edit({...scope,requestId,expectedRevision:4,edit:{type:"pause"}})).toEqual(state);
  invoke.mockResolvedValue({...state,revision:6});
  await expect(gateway.edit({...scope,requestId,expectedRevision:4,edit:{type:"pause"}})).rejects.toThrow();
  expect(scope.scope.kind).toBe("note");
  expect(()=>decodeAgentNoteQueueResponse({...state,preparingInputId:turnId})).toThrow();
});
it("recovers only a bounded, ordered admission page with original confirmation",async()=>{
  const {scope}=fixture("note"),row={requestId,turnId,createdAt:"2026-09-11T12:00:00Z",messageExcerpt:"Queued",queue:{inputId,expectedRevision:5}};
  const result={schemaVersion:1,...scope,items:[row],nextCursor:requestId};
  const invoke=vi.fn().mockResolvedValue(result),gateway=createAgentNoteQueueGateway(invoke);
  expect(await gateway.list({...scope,after:null,limit:1})).toEqual(result);
  await expect(gateway.list({...scope,after:requestId,limit:1})).rejects.toThrow();
  await expect(gateway.list({...scope,after:null,limit:2})).rejects.toThrow();
  for(const value of [{...result,items:[row,row]}, {...result,items:[{...row,queue:{...row.queue,expectedRevision:-1}}]}, {...result,nextCursor:turnId}]){
    invoke.mockResolvedValue(value);await expect(gateway.list({...scope,after:null,limit:1})).rejects.toThrow();
  }
});
