import {AgentSteeringHandoffController} from "./steeringHandoffController";
import {PendingOperationRegistry} from "./pendingOperationRegistry";
import type {AgentSteeringHandoffGateway} from "./steeringHandoff";
import type {AgentQueueEditScope,AgentSteeringHandoffIntent} from "@research-assistant/core/agent";

export class AgentSteeringHandoffRegistry {
  private readonly owner=new PendingOperationRegistry<AgentSteeringHandoffController>(controller=>{
    const state=controller.getSnapshot();return !!state.intent || state.items.length>0 || ["preparing","sending","uncertain","recovering"].includes(state.phase);
  });
  constructor(private readonly gateway:AgentSteeringHandoffGateway,
    private readonly send:(request:{conversationId:string;turnId:string;inputId:string;text:string;userInput:AgentSteeringHandoffIntent["userInput"]},scope:AgentQueueEditScope)=>Promise<unknown>,
    private readonly id:()=>string, private readonly acceptsScope?:(scope:AgentQueueEditScope)=>boolean,
    private readonly gatewayIdentity:object=gateway,
    private readonly captureNewOwner?:(scope:{conversationId:string})=>((inputId:string)=>Promise<void>)|undefined){}
  retain():()=>void{return this.owner.retain();}
  hasPending(scopeKind?: AgentQueueEditScope["kind"]): boolean {
    if (scopeKind === undefined) return this.owner.hasPending();
    return this.owner.hasPending(controller => {
      const {intent, items} = controller.getSnapshot();
      // Recovery can be pending before its original scope has been read.
      return (!intent && items.length === 0) || intent?.scope.kind === scopeKind
        || items.some(item => item.intent.scope.kind === scopeKind);
    });
  }
  ownsGateway(gateway:AgentSteeringHandoffGateway):boolean{return this.gatewayIdentity===gateway;}
  acquire(conversationId:string){return this.owner.acquire(conversationId,conversationId,()=>new AgentSteeringHandoffController(conversationId,this.gateway,this.send,this.id,this.acceptsScope,this.captureNewOwner));}
  forgetConversation(conversationId:string):void{this.owner.forgetConversation(conversationId);}
  dispose():void{this.owner.dispose();}
}
