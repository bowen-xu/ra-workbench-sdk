import { EMPTY_AGENT_CONTEXT, decodeAgentContextConfigurationSaveIntent, decodeAgentContextState,
  type AgentContextConfigurationSaveIntent, type AgentContextState } from "@research-assistant/core/agent";
import { DocumentVersionConflict, type DocumentCommit, type DocumentPort, type DocumentSnapshot } from "@research-assistant/core/hbs";
import type { AgentContextConfigurationSaveGateway } from "./contextConfigurationSave";

/** The host owns durable scoped storage and its cross-window lock. `write`
 * resolves only after persistence; on failure the host must retain the prior
 * record or fail closed, never treating an uncertain write as clear. */
export interface ContextConfigurationOutbox {
  run<T>(operation:()=>Promise<T>):Promise<T>;
  read():Promise<unknown | null>;
  write(intent:AgentContextConfigurationSaveIntent | null):Promise<void>;
}
export class ContextConfigurationWriteRevoked extends Error {
  constructor(readonly intentPersisted:boolean) {super("CONTEXT_CONFIGURATION_WRITE_REVOKED");}
}
export interface ContextConfigurationDocumentPort extends DocumentPort<AgentContextState> {
  /** Epoch of the authority last read by this document port. */
  dataEpoch():string|null;
  /** Inspect the original operation; a missing receipt never authorizes clearing it. */
  inspect():Promise<"empty" | "committed" | "unconfirmed">;
  /** Explicitly retry the original frozen operation. */
  retry():Promise<void>;
  retryGuarded(canWrite:()=>boolean):Promise<void>;
  /** Freeze an initialization intent only while its host remains writable. */
  commitGuarded(request:DocumentCommit<AgentContextState>,canWrite:()=>boolean):Promise<DocumentSnapshot<AgentContextState>>;
}
function same(a:unknown,b:unknown):boolean { return JSON.stringify(a)===JSON.stringify(b); }
function snapshot(version:number,state:AgentContextState):DocumentSnapshot<AgentContextState> {
  return {version,saved:structuredClone(state),baseline:structuredClone(state)};
}

/** Transport adapter only: HBS owns editing, reconciliation and preservation.
 * The present configuration store has no candidate baseline, so an unequal
 * saved/baseline pair is rejected instead of silently accepting candidates. */
export function createContextConfigurationDocumentPort(conversationId:string, gateway:AgentContextConfigurationSaveGateway,
  outbox:ContextConfigurationOutbox, newId:()=>string, hostCanWrite:()=>boolean=()=>true):ContextConfigurationDocumentPort {
  let epoch:string|null=null;
  async function pending():Promise<AgentContextConfigurationSaveIntent|null> {
    const value=await outbox.read();
    if(value===null)return null;
    const intent=decodeAgentContextConfigurationSaveIntent(value);
    if(intent.conversationId!==conversationId.toLowerCase())throw new Error("CONTEXT_CONFIGURATION_RECOVERY_SCOPE_MISMATCH");
    return intent;
  }
  async function environment(operationId:string):Promise<DocumentSnapshot<AgentContextState>> {
    const value=await gateway.environment({operationId,conversationId});
    if(epoch!==null && value.epoch!==epoch)throw new Error("CONTEXT_CONFIGURATION_EPOCH_MISMATCH");
    epoch=value.epoch;
    return snapshot(value.configuration?.revision??0,value.configuration?.state??EMPTY_AGENT_CONTEXT);
  }
  async function clear(intent:AgentContextConfigurationSaveIntent):Promise<void> {
    const current=await pending();
    if(!current || !same(current,intent))throw new Error("CONTEXT_CONFIGURATION_RECOVERY_CHANGED");
    await outbox.write(null);
  }
  async function observe(intent:AgentContextConfigurationSaveIntent):Promise<boolean> {
    const status=await gateway.status(structuredClone(intent));
    if(status.type!=="committed")return false;
    await clear(intent);return true;
  }
  async function execute(intent:AgentContextConfigurationSaveIntent):Promise<void> {
    try {
      await gateway.save(structuredClone(intent));
    } catch(error) {
      // A confirmed CAS rejection cannot commit later: versions are monotonic.
      // Only this exact native domain error permits replacing the old request.
      if(error!=="confirmationMismatch")throw error;
      const latest=await environment(newId());
      await clear(intent);
      throw new DocumentVersionConflict(latest,intent.operationId);
    }
    await clear(intent);
  }
  function commit(request:DocumentCommit<AgentContextState>,canWrite:()=>boolean):Promise<DocumentSnapshot<AgentContextState>> {
    return outbox.run(async()=>{
      if(!canWrite())throw new ContextConfigurationWriteRevoked(false);
      const saved=decodeAgentContextState(request.saved),baseline=decodeAgentContextState(request.baseline);
      if(!same(saved,baseline))throw new Error("CONTEXT_CONFIGURATION_REVIEW_BASELINE_UNSUPPORTED");
      if(epoch===null)throw new Error("CONTEXT_CONFIGURATION_ENVIRONMENT_REQUIRED");
      const intent=decodeAgentContextConfigurationSaveIntent({operationId:request.id,conversationId,expectedEpoch:epoch,expectedRevision:request.expectedVersion,state:saved});
      const original=await pending();
      if(original && !same(original,intent))throw new Error("CONTEXT_CONFIGURATION_ORIGINAL_PENDING");
      if(!canWrite())throw new ContextConfigurationWriteRevoked(!!original);
      if(!original)await outbox.write(intent);
      if(!canWrite())throw new ContextConfigurationWriteRevoked(true);
      await execute(intent);
      return snapshot(intent.expectedRevision+1,intent.state);
    });
  }
  function retry(canWrite:()=>boolean):Promise<void> {
    return outbox.run(async()=>{
      const original=await pending();if(!original)throw new Error("CONTEXT_CONFIGURATION_ORIGINAL_MISSING");
      if(epoch!==null && epoch!==original.expectedEpoch)throw new Error("CONTEXT_CONFIGURATION_EPOCH_MISMATCH");
      if(await observe(original))return;
      if(!canWrite())throw new ContextConfigurationWriteRevoked(true);
      epoch=original.expectedEpoch;
      await execute(original);
    });
  }
  return {
    dataEpoch:()=>epoch,
    read:()=>outbox.run(async()=>{
      const original=await pending();
      if(original){
        if(epoch!==null && epoch!==original.expectedEpoch)throw new Error("CONTEXT_CONFIGURATION_EPOCH_MISMATCH");
        epoch=original.expectedEpoch;await observe(original);
      }
      return environment(newId());
    }),
    commit:(request:DocumentCommit<AgentContextState>)=>commit(request,hostCanWrite),
    commitGuarded:(request,canWrite)=>commit(request,()=>hostCanWrite()&&canWrite()),
    inspect:()=>outbox.run(async()=>{
      const original=await pending();if(!original)return "empty";
      if(epoch!==null && epoch!==original.expectedEpoch)throw new Error("CONTEXT_CONFIGURATION_EPOCH_MISMATCH");
      return await observe(original)?"committed":"unconfirmed";
    }),
    retry:()=>retry(hostCanWrite),
    retryGuarded:canWrite=>retry(()=>hostCanWrite()&&canWrite()),
  };
}
