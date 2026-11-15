import {decodeAgentQueuedText,decodeAgentUserInput,type AgentUserInput,type AgentConversationProjection} from "@research-assistant/core/agent";
import {isAgentSteeringRejection} from "./steeringRejection";

export type AgentSteeringQueueRejection<S> = (request: S & {inputId: string; text: string; userInput?: readonly AgentUserInput[]}) => Promise<boolean>;

export interface AgentSteeringState<S> {
  readonly phase:"idle"|"sending"|"uncertain"|"accepted"|"rejected"|"queued";
  readonly request:(S&{readonly inputId:string;readonly text:string;readonly userInput?:readonly AgentUserInput[]})|null;
  readonly status:string;
  readonly awaitingHistory?:readonly (S&{readonly inputId:string;readonly text:string;readonly userInput?:readonly AgentUserInput[]})[];
  readonly transferFailures?:readonly string[];
}
/** Mounted per host/conversation. Unknown admissions retain their original turn and input ID. */
export class AgentSteeringController<S extends {conversationId:string;turnId:string}> {
  private state:AgentSteeringState<S>={phase:"idle",request:null,status:""};
  private readonly listeners=new Set<()=>void>();
  private live=true;
  private epoch=0;
  private acknowledgment:(()=>void)|undefined;
  private rejection:(()=>void)|undefined;
  private readonly confirmations=new Map<string,()=>void|boolean|Promise<void|boolean>>();
  private readonly confirmedHistory=new Set<string>();
  private readonly settling=new Set<string>();
  private queueRejected: AgentSteeringQueueRejection<S> | undefined;
  private prepareNewIntent: ((inputId:string)=>Promise<void>)|undefined;
  private intentReady = false;
  private isAdmissionDisabled: (() => boolean) | undefined;
  constructor(private readonly send:(request:S&{inputId:string;text:string;userInput?:readonly AgentUserInput[]})=>Promise<unknown>,private readonly id:()=>string,
    private readonly captureNewIntent?: (scope:S)=>((inputId:string)=>Promise<void>)|undefined){}
  getSnapshot=():AgentSteeringState<S>=>this.state;
  subscribe=(listener:()=>void):(()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
  private update(state:AgentSteeringState<S>):void{if(!this.live)return;this.state={...state,awaitingHistory:state.awaitingHistory??this.state.awaitingHistory??[],transferFailures:state.transferFailures??this.state.transferFailures??[]};if(state.phase==="accepted"){const acknowledge=this.acknowledgment;this.acknowledgment=undefined;acknowledge?.();}for(const listener of this.listeners)listener();}
  async submit(scope:S,text:string,acknowledgment?:()=>void,rejection?:()=>void,userInput?:readonly AgentUserInput[],confirmed?:()=>void|boolean|Promise<void|boolean>,queueRejected?:AgentSteeringQueueRejection<S>,isAdmissionDisabled?:()=>boolean):Promise<boolean>{
    if(!this.live||this.state.phase==="sending"||this.state.phase==="uncertain")return false;
    if(isAdmissionDisabled?.()){rejection?.();return false;}
    let value:string;
    try{value=decodeAgentQueuedText(text);decodeAgentUserInput(userInput,value);}catch{rejection?.();this.update({phase:"rejected",request:null,status:"补充说明或资源引用无效；草稿已保留。"});return false;}
    try {this.prepareNewIntent=this.captureNewIntent?.(structuredClone(scope));this.intentReady=false;}
    catch {rejection?.();this.update({phase:"rejected",request:null,status:"QUEUE_PERSISTENCE_FAILED：补充说明尚未可靠保存，未发送。"});return false;}
    this.acknowledgment=acknowledgment;
    this.rejection=rejection;
    this.queueRejected=queueRejected;
    this.isAdmissionDisabled=isAdmissionDisabled;
    const request={...structuredClone(scope),inputId:this.id(),text:value,...(userInput?.length ? {userInput:structuredClone(userInput)} : {})};
    if(confirmed)this.confirmations.set(request.inputId,confirmed);
    this.update({phase:"sending",request,status:"正在提交补充说明…",awaitingHistory:[...(this.state.awaitingHistory??[]),request]});
    return this.dispatch(request,false);
  }
  async retry():Promise<boolean>{
    if(!this.live||this.state.phase!=="uncertain"||!this.state.request)return false;
    return this.dispatch(this.state.request,true);
  }
  private async dispatch(request:S&{inputId:string;text:string;userInput?:readonly AgentUserInput[]},wasUncertain:boolean,mismatchRetried=false):Promise<boolean>{
    const epoch=++this.epoch;
    this.update({phase:"sending",request,status:"正在提交补充说明…"});
    if(this.prepareNewIntent&&!this.intentReady){
      try {await this.prepareNewIntent(request.inputId);}
      catch {if(!this.live||epoch!==this.epoch)return false;const reject=this.rejection;this.rejection=undefined;this.acknowledgment=undefined;reject?.();this.confirmations.delete(request.inputId);
        this.update({phase:"rejected",request,status:"QUEUE_PERSISTENCE_FAILED：补充说明尚未可靠保存，未发送。",awaitingHistory:(this.state.awaitingHistory??[]).filter(item=>item.inputId!==request.inputId)});return false;}
      if(!this.live||epoch!==this.epoch)return false;
      this.intentReady=true;
    }
    const outgoing=structuredClone(request);
    if(!wasUncertain&&this.isAdmissionDisabled?.()){
      const reject=this.rejection;this.rejection=undefined;this.acknowledgment=undefined;reject?.();
      this.confirmations.delete(request.inputId);
      this.update({phase:"rejected",request,status:`WRITING_RUNTIME_UNAVAILABLE：写作插件未就绪，补充说明未发送，草稿已保留。[conversationId=${request.conversationId}；turnId=${request.turnId}；inputId=${request.inputId}]`,
        awaitingHistory:(this.state.awaitingHistory??[]).filter(item=>item.inputId!==request.inputId)});
      return false;
    }
    try{
      await this.send(outgoing);if(!this.live||epoch!==this.epoch)return false;
      if(this.state.phase==="accepted")return true;
      this.update({phase:"accepted",request,status:"补充说明已接收，等待本轮继续处理。"});return true;
    }catch(error){
      if(!this.live||epoch!==this.epoch)return false;
      if(this.state.phase==="accepted")return true;
      const code=error&&typeof error==="object"&&"code" in error?error.code:null;
      const actualTurnId=error&&typeof error==="object"&&"actualTurnId" in error?error.actualTurnId:null;
      if(!wasUncertain&&!mismatchRetried&&code==="expectedTurnMismatch"&&typeof actualTurnId==="string"&&/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(actualTurnId)&&actualTurnId!==request.turnId){
        const updated={...request,turnId:actualTurnId};
        this.update({...this.state,awaitingHistory:(this.state.awaitingHistory??[]).map(item=>item.inputId===request.inputId?updated:item)});
        return this.dispatch(updated,false,true);
      }
      const rejected=!wasUncertain&&isAgentSteeringRejection(error);
      if(rejected){const reject=this.rejection;this.rejection=undefined;this.acknowledgment=undefined;reject?.();}
      if(rejected){
        this.confirmations.delete(request.inputId);
        this.update({...this.state,awaitingHistory:(this.state.awaitingHistory??[]).filter(item=>item.inputId!==request.inputId)});
        if(["closed","capacity","notSteerable","activeTurnNotSteerable","expectedTurnMismatch"].includes(String(code))&&this.queueRejected){
          try{if(await this.queueRejected(structuredClone(request))){
            if(!this.live||epoch!==this.epoch)return false;
            this.update({phase:"queued",request,status:"补充说明已保留到下一轮队列。"});return false;
          }}catch{/* Queue owner preserves its original receipt/draft on failure. */}
        }
      }
      this.update({phase:rejected?"rejected":"uncertain",request,status:!rejected?"接收结果未确认；请重试原补充说明，不能把它改投其他轮次。":code==="closed"?"本轮已停止接收补充说明，草稿已保留，可加入下一轮队列。":code==="capacity"?"本轮补充说明已达上限，草稿已保留，可加入下一轮队列。":request.userInput?.some(item=>item.type!=="text")?"引用资源已失效、版本已变化或不在本轮授权范围内；草稿已保留，请重新选择资源后重试。":"补充说明未被接收，草稿已保留，请检查后重试。"});return false;
    }
  }
  observeHistory(projection:AgentConversationProjection):string|null{
    if(!this.live)return null;
    const confirmed=(this.state.awaitingHistory??[]).filter(request=>{
      if(projection.conversationId!==request.conversationId)return false;
      const item=projection.turns.get(request.turnId)?.items.get(request.inputId);
      return item?.kind.type==="userMessage"&&item.completed&&!item.interrupted&&item.text===request.text;
    });
    for(const item of confirmed){
      this.confirmedHistory.add(item.inputId);
      if(!this.settling.has(item.inputId) && !(this.state.transferFailures??[]).includes(item.inputId)) this.settleConfirmation(item.inputId);
    }
    const request=this.state.request;
    if(!this.live||!request||!["sending","uncertain"].includes(this.state.phase)||projection.conversationId!==request.conversationId)return null;
    const item=projection.turns.get(request.turnId)?.items.get(request.inputId);
    if(item?.kind.type!=="userMessage"||!item.completed||item.interrupted||item.text!==request.text)return null;
    this.update({phase:"accepted",request,status:"补充说明已进入本轮对话记录。"});return request.text;
  }
  private settleConfirmation(inputId:string):void{
    if(!this.live||!this.confirmedHistory.has(inputId)||this.settling.has(inputId))return;
    const callback=this.confirmations.get(inputId);
    if(!callback){this.finishConfirmation(inputId);return;}
    this.settling.add(inputId);
    try{
      const result=callback();
      if(result instanceof Promise){void result.then(value=>this.resolveConfirmation(inputId,value!==false),()=>this.resolveConfirmation(inputId,false));}
      else this.resolveConfirmation(inputId,result!==false);
    }catch{this.resolveConfirmation(inputId,false);}
  }
  private resolveConfirmation(inputId:string,success:boolean):void{
    this.settling.delete(inputId);
    if(!this.live)return;
    if(success)this.finishConfirmation(inputId);
    else this.update({...this.state,transferFailures:[...new Set([...(this.state.transferFailures??[]),inputId])]});
  }
  private finishConfirmation(inputId:string):void{
    this.confirmations.delete(inputId);this.confirmedHistory.delete(inputId);
    this.update({...this.state,status:this.state.phase==="accepted"&&this.state.request?.inputId===inputId?"":this.state.status,
      awaitingHistory:(this.state.awaitingHistory??[]).filter(item=>item.inputId!==inputId),
      transferFailures:(this.state.transferFailures??[]).filter(id=>id!==inputId)});
  }
  retryConfirmation(inputId:string):void{
    if(!this.live||!(this.state.transferFailures??[]).includes(inputId))return;
    this.update({...this.state,transferFailures:(this.state.transferFailures??[]).filter(id=>id!==inputId)});
    this.settleConfirmation(inputId);
  }
  dispose():void{this.live=false;this.acknowledgment=undefined;this.rejection=undefined;this.confirmations.clear();this.confirmedHistory.clear();this.settling.clear();this.listeners.clear();}
}
