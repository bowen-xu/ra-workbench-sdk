import {decodeAgentSqlImmediateFailure,decodeAgentSteeringHandoffIntent, type AgentQueueEditScope, type AgentQueueState, type AgentSteeringHandoffIntent,
  type AgentSteeringHandoffPage} from "@research-assistant/core/agent";
import type {AgentSteeringHandoffGateway} from "./steeringHandoff";
import {isAgentSteeringRejection} from "./steeringRejection";

type Item = AgentSteeringHandoffPage["items"][number];
function diagnostics(error:unknown):string{
  const failure=decodeAgentSqlImmediateFailure(error);
  if(failure){const detail=failure.diagnostic;return ` [code=${failure.code}${detail?.operationId?`；operation=${detail.operationId}`:""}${detail?.safeCause?`；cause=${detail.safeCause}`:""}]`;}
  const code=error&&typeof error==="object"&&"code" in error?error.code:error instanceof Error?error.message:undefined;
  return typeof code==="string"&&/^[A-Za-z][A-Za-z0-9_-]{0,100}$/u.test(code)?` [code=${code}]`:"";
}
/** Native returns these operation-bound failures only after verified rollback.
 * A previous Unknown for this exact intent still takes precedence. */
function prepareRejected(error:unknown,intent:AgentSteeringHandoffIntent):boolean{
  const failure=decodeAgentSqlImmediateFailure(error),detail=failure?.diagnostic;
  if(failure?.code!=="DATA_SQL_OPERATION_CONFLICT" || !detail || detail.operationId!==intent.operationId
    || detail.phase!=="steering-handoff-prepare" || !detail.epoch || detail.sqlFence==null
    || ["operationId","epoch","sqlFence","phase","sqliteCode","sqliteExtendedCode","safeCause"].some(field=>!Object.hasOwn(detail,field)))return false;
  if(detail.safeCause==="data_epoch_changed")return intent.expectedEpoch!==null && detail.epoch!==intent.expectedEpoch;
  return (intent.expectedEpoch===null || detail.epoch===intent.expectedEpoch)
    && ["handoff_scope_unavailable","handoff_registration_canceled","handoff_encoding_failed","handoff_already_finished",
      "handoff_already_released","handoff_identity_changed","handoff_turn_unavailable","handoff_queue_unavailable",
      "handoff_queue_changed","handoff_queue_already_owned"].includes(detail.safeCause??"");
}
export interface AgentSteeringHandoffState {
  readonly phase: "loading" | "ready" | "preparing" | "sending" | "waiting" | "uncertain" | "recovering" | "error";
  readonly epoch: string | null;
  readonly items: readonly Item[];
  readonly intent: AgentSteeringHandoffIntent | null;
  readonly message: string;
  /** Volatile proof of steer acceptance: verified send receipt or complete history. */
  readonly acceptedOperationIds?: readonly string[];
  /** Each durably settled operation may change the queue, even if others wait. */
  readonly settledSequence?: number;
}
/** One conversation's persistent queue-to-steer owner. A read never proves that
 * an in-flight registration failed, and recovery never resends a steer. */
export class AgentSteeringHandoffController {
  private state: AgentSteeringHandoffState={phase:"loading",epoch:null,items:[],intent:null,message:"",acceptedOperationIds:[],settledSequence:0};
  private readonly listeners=new Set<()=>void>();
  private live=true;
  private busy=false;
  private refreshing=false;
  private prepared=false;
  private prepareNewOwner: ((inputId:string)=>Promise<void>)|undefined;
  private ownerReady=false;
  private isAdmissionDisabled:(()=>boolean)|undefined;
  private prepareMayHaveDispatched=false;
  private steerMayHaveDispatched=false;
  private prepareKnownRejected=false;
  private steerKnownRejected=false;
  private admissionBlocked=false;
  private resolution:{readonly action:"finish"|"release"|"cancelUnregistered";readonly intent:AgentSteeringHandoffIntent;readonly epoch:string}|null=null;
  constructor(private readonly conversationId:string, private readonly gateway:AgentSteeringHandoffGateway,
    private readonly send:(request:{conversationId:string;turnId:string;inputId:string;text:string;userInput:AgentSteeringHandoffIntent["userInput"]},scope:AgentQueueEditScope)=>Promise<unknown>,
    private readonly id:()=>string, private readonly acceptsScope:(scope:AgentQueueEditScope)=>boolean=scope=>scope.kind==="context",
    private readonly captureNewOwner?:(scope:{conversationId:string})=>((inputId:string)=>Promise<void>)|undefined) {}
  getSnapshot=():AgentSteeringHandoffState=>this.state;
  subscribe=(listener:()=>void):(()=>void)=>{this.listeners.add(listener);return()=>this.listeners.delete(listener);};
  dispose():void{this.live=false;this.listeners.clear();}
  private update(patch:Partial<AgentSteeringHandoffState>):void{
    if(!this.live)return;this.state={...this.state,...patch};for(const listener of this.listeners)listener();
  }
  private accept(operationId:string):void{
    if(!this.state.acceptedOperationIds?.includes(operationId))this.update({acceptedOperationIds:[...(this.state.acceptedOperationIds??[]),operationId]});
  }
  private settled():void{this.update({settledSequence:(this.state.settledSequence??0)+1});}
  /** A new handoff may start once every existing handoff is durably registered
   * and its steer was accepted. A send still in flight is never inferred from a read. */
  canSubmit(turnId:string):boolean{
    if(!this.live||this.busy||this.refreshing||!this.state.epoch)return false;
    if(this.state.phase==="ready")return true;
    if(this.state.phase!=="waiting")return false;
    const {items,intent,acceptedOperationIds=[]}=this.state;
    if(!items.length || intent && !items.some(item=>item.intent.operationId===intent.operationId && JSON.stringify(item.intent)===JSON.stringify(intent)))return false;
    return items.every(item=>item.intent.turnId===turnId && item.history==="unconfirmed" && acceptedOperationIds.includes(item.intent.operationId));
  }
  /** isTerminal is based on the synchronized projection of the original turn. */
  async refresh(isTerminal:(turnId:string)=>boolean):Promise<boolean>{
    if(!this.live||this.refreshing||(this.busy&&!this.prepared))return false;
    this.refreshing=true;
    let original=this.state.intent; const priorPhase=this.state.phase,priorMessage=this.state.message;
    this.update({phase:"recovering",message:"正在核对队列引导…"});
    try {
      if(this.resolution){
        const pending=this.resolution;
        const status=await this.gateway.resolution(pending.intent,pending.epoch);
        if(!this.live)return false;
        if(status==="canceled" && this.prepared && original?.operationId===pending.intent.operationId)throw new Error("STEERING_HANDOFF_RESOLUTION_CONFLICT");
        if(status==="unconfirmed")await this.gateway[pending.action](pending.intent,pending.epoch);
        if(!this.live)return false;
        this.resolution=null;
        this.settled();
        if(original?.operationId===pending.intent.operationId){original=null;this.prepared=false;this.update({intent:null});}
      }
      let page=await this.gateway.read(this.conversationId,this.state.epoch??undefined);
      if(!this.live)return false;
      // Only a transactional cancellation can fence a delayed registration.
      if(original && !page.items.some(item=>item.intent.operationId===original?.operationId)) {
        const status=await this.gateway.resolution(original,page.epoch);
        if(!this.live)return false;
        if(status==="canceled" && this.prepared)throw new Error("STEERING_HANDOFF_RESOLUTION_CONFLICT");
        if(status!=="unconfirmed"){
          this.settled();this.prepared=false;original=null;this.update({intent:null});
          page=await this.gateway.read(this.conversationId,page.epoch);
        }else if(!this.prepared && isTerminal(original.turnId)){
          this.resolution={action:"cancelUnregistered",intent:original,epoch:page.epoch};
          await this.gateway.cancelUnregistered(original,page.epoch);
          if(!this.live)return false;
          this.resolution=null;this.settled();this.prepared=false;original=null;this.update({intent:null});
          page=await this.gateway.read(this.conversationId,page.epoch);
        }else{
          this.update({phase:"uncertain",epoch:page.epoch,items:page.items,intent:original,message:"原交接结果尚未确认，请重试原请求。"});return false;
        }
      }
      if(original && page.items.some(item=>item.intent.operationId===original?.operationId && JSON.stringify(item.intent)!==JSON.stringify(original)))
        throw new Error("STEERING_HANDOFF_INTENT_MISMATCH");
      for(const item of page.items){
        if(item.history==="confirmed")this.accept(item.intent.operationId);
        const action=item.history==="confirmed"?"finish":item.history==="unconfirmed"&&isTerminal(item.intent.turnId)?"release":null;
        if(!action)continue;
        this.resolution={action,intent:item.intent,epoch:page.epoch};
        // Reconciliation of an older item must not replace the independently
        // in-flight intent whose send receipt is still outstanding.
        if(!original || original.operationId===item.intent.operationId)this.update({intent:item.intent});
        await this.gateway[action](item.intent,page.epoch);
        if(!this.live)return false;
        this.resolution=null;
        this.settled();
        if(original?.operationId===item.intent.operationId){original=null;this.prepared=false;}
        this.update({intent:original});
      }
      if(page.items.some(item=>item.history==="confirmed" || item.history==="unconfirmed"&&isTerminal(item.intent.turnId)))
        page=await this.gateway.read(this.conversationId,page.epoch);
      if(!this.live)return false;
      const remains=original && page.items.some(item=>item.intent.operationId===original?.operationId);
      if(original && !remains)this.prepared=false;
      const intent=remains ? original : null;
      const unresolvedIds=new Set([...page.items.map(item=>item.intent.operationId),...(intent?[intent.operationId]:[])]);
      this.update({epoch:page.epoch,items:page.items,intent,acceptedOperationIds:(this.state.acceptedOperationIds??[]).filter(id=>unresolvedIds.has(id)),phase:intent&&priorPhase==="uncertain"?"uncertain":page.items.length?"waiting":"ready",
        message:intent&&priorPhase==="uncertain"?priorMessage:page.items.length?"队列引导等待原回合和历史核对。":""});
      return page.items.length===0;
    }catch(error){
      if(this.resolution?.action==="cancelUnregistered" && decodeAgentSqlImmediateFailure(error)?.diagnostic?.safeCause==="handoff_already_registered")this.resolution=null;
      if(this.live)this.update({phase:original&&priorPhase==="uncertain"?"uncertain":"error",message:`队列引导尚未核对，原消息已保留。${diagnostics(error)}`});
      return false;
    }finally{this.refreshing=false;this.update({});}
  }
  async submit(queue:AgentQueueState, turnId:string, queueInputId:string, scope:AgentQueueEditScope={kind:"context"},isAdmissionDisabled?:()=>boolean):Promise<boolean>{
    if(!this.canSubmit(turnId)||!this.state.epoch||queue.conversationId!==this.conversationId||queue.preparingInputId||!this.acceptsScope(scope))return false;
    if(isAdmissionDisabled?.())return false;
    if(this.state.items.some(item=>item.intent.queueInputId===queueInputId))return false;
    const queueIndex=queue.inputs.findIndex(input=>input.inputId===queueInputId), input=queue.inputs[queueIndex];
    if(!input)return false;
    let intent:AgentSteeringHandoffIntent;
    try { intent=decodeAgentSteeringHandoffIntent({operationId:this.id(),conversationId:this.conversationId,turnId,
      steeringInputId:this.id(),queueInputId,expectedRevision:queue.revision,expectedEpoch:this.state.epoch,
      scope:structuredClone(scope),queueIndex,queuePaused:queue.paused,inputPaused:!!input.paused,origin:input.origin??null,
      text:input.text,userInput:input.userInput??[]}); }
    catch{return false;}
    try {this.prepareNewOwner=this.captureNewOwner?.({conversationId:this.conversationId});this.ownerReady=false;}
    catch {this.update({phase:"error",message:"QUEUE_PERSISTENCE_FAILED：队列引导尚未可靠保存，未发送。"});return false;}
    this.prepared=false;
    this.isAdmissionDisabled=isAdmissionDisabled;this.prepareMayHaveDispatched=false;this.steerMayHaveDispatched=false;this.admissionBlocked=false;
    this.prepareKnownRejected=false;this.steerKnownRejected=false;
    this.update({intent,phase:"preparing",message:"正在保存队列引导…"});
    return this.dispatch();
  }
  async retry():Promise<boolean>{
    if(!this.live||this.busy||this.refreshing||(this.state.phase!=="uncertain"&&!this.admissionBlocked)||!this.state.intent)return false;
    return this.dispatch();
  }
  private async dispatch():Promise<boolean>{
    const intent=this.state.intent;if(!intent||this.busy)return false;
    this.busy=true;
    let dispatched:"prepare"|"steer"|undefined,replayingUnknown=false;
    try{
      if(this.prepareNewOwner&&!this.ownerReady){
        await this.prepareNewOwner(intent.operationId);
        if(!this.live)return false;
        await this.prepareNewOwner(intent.steeringInputId);
        if(!this.live)return false;
        this.ownerReady=true;
      }
      if(!this.prepared){
        const outgoing=structuredClone(intent);
        this.update({phase:"preparing",message:"正在保存队列引导…"});
        replayingUnknown=this.prepareMayHaveDispatched&&!this.prepareKnownRejected;
        if(!replayingUnknown&&this.isAdmissionDisabled?.())return this.blockAdmission(intent);
        dispatched="prepare";this.prepareKnownRejected=false;
        this.prepareMayHaveDispatched=true;
        await this.gateway.prepare(outgoing);
        if(!this.live)return false;
        this.prepared=true;
      }
      this.admissionBlocked=false;
      const request={conversationId:intent.conversationId,turnId:intent.turnId,inputId:intent.steeringInputId,text:intent.text,userInput:structuredClone(intent.userInput)};
      const scope=structuredClone(intent.scope);
      this.update({phase:"sending",message:"正在提交队列引导…"});
      replayingUnknown=this.steerMayHaveDispatched&&!this.steerKnownRejected;
      if(!replayingUnknown&&this.isAdmissionDisabled?.())return this.blockAdmission(intent);
      dispatched="steer";this.steerKnownRejected=false;
      this.steerMayHaveDispatched=true;
      await this.send(request,scope);
      if(!this.live)return false;
      if(this.state.intent?.operationId!==intent.operationId)return true;
      this.accept(intent.operationId);
      // A concurrent reconciliation can discover a separate unresolved error;
      // an admission receipt must not erase that recovery state.
      if(this.refreshing || this.state.phase==="error" || this.state.phase==="uncertain")return true;
      this.update({phase:"waiting",message:"已接收，等待原回合历史确认。"});return true;
    }catch(error){
      if(this.state.intent?.operationId!==intent.operationId)return true;
      if(!replayingUnknown){
        if(dispatched==="prepare")this.prepareKnownRejected=prepareRejected(error,intent);
        if(dispatched==="steer")this.steerKnownRejected=isAgentSteeringRejection(error);
      }
      if(this.live)this.update({phase:"uncertain",message:`队列引导结果未确认，请重试原请求或核对原回合。${diagnostics(error)}`});
      return false;
    }finally{this.busy=false;this.update({});}
  }
  private blockAdmission(intent:AgentSteeringHandoffIntent):false{
    this.admissionBlocked=this.prepareMayHaveDispatched;
    this.update({phase:"error",...(!this.prepareMayHaveDispatched?{intent:null}:{}),
      message:`WRITING_RUNTIME_UNAVAILABLE：写作插件未就绪，尚未发送新的队列引导，原队列与恢复记录已保留。[conversationId=${intent.conversationId}；operationId=${intent.operationId}；inputId=${intent.steeringInputId}；queueInputId=${intent.queueInputId}]`});
    return false;
  }
}
