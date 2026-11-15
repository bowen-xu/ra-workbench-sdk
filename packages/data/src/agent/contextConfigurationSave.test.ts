import { describe, expect, it, vi } from "vitest";
import { createAgentContextConfigurationSaveGateway } from "./contextConfigurationSave";

const operationId="11111111-1111-4111-8111-111111111111";
const conversationId="22222222-2222-4222-8222-222222222222";
const expectedEpoch="33333333-3333-4333-8333-333333333333";
const intent={operationId,conversationId,expectedEpoch,expectedRevision:4,state:{schemaVersion:1 as const,persistent:[],temporary:[]}};
const proof={schemaVersion:1,operationId,conversationId,epoch:expectedEpoch,family:"agent.context.configuration.save",sqlFence:"9007199254740993",replayed:false,result:null};

describe("proven context configuration saves",()=>{
  it("reads the environment and current configuration under the original identity",async()=>{
    const environment={schemaVersion:1,operationId,conversationId,epoch:expectedEpoch,sqlFence:"0",configuration:{revision:2,state:intent.state}};
    const invoke=vi.fn(async()=>environment),gateway=createAgentContextConfigurationSaveGateway(invoke);
    expect(await gateway.environment({operationId,conversationId})).toEqual(environment);
    expect(invoke).toHaveBeenCalledWith("agent_read_context_configuration_environment",{request:{operationId,conversationId}});
    invoke.mockResolvedValueOnce({...environment,operationId:conversationId});
    await expect(gateway.environment({operationId,conversationId})).rejects.toThrow("CONTEXT_CONFIGURATION_ENVIRONMENT_MISMATCH");
    invoke.mockResolvedValueOnce({...environment,configuration:{revision:0,state:intent.state}});
    await expect(gateway.environment({operationId,conversationId})).rejects.toThrow();
  });
  it("sends the complete original intent and validates its immutable proof",async()=>{
    const invoke=vi.fn(async()=>proof), gateway=createAgentContextConfigurationSaveGateway(invoke);
    expect(await gateway.save(intent)).toEqual(proof);
    expect(invoke).toHaveBeenCalledExactlyOnceWith("agent_save_context_configuration_proven",{request:intent});
    for(const changed of [{operationId:conversationId},{conversationId:operationId},{epoch:operationId},{family:"other"}]){
      invoke.mockResolvedValueOnce({...proof,...changed});
      await expect(gateway.save(intent)).rejects.toThrow();
    }
  });
  it("inspects the original intent without converting absence into success",async()=>{
    const invoke=vi.fn(async():Promise<unknown>=>({type:"noSqlReceipt",epoch:expectedEpoch,sqlFence:"0",closed:false}));
    const gateway=createAgentContextConfigurationSaveGateway(invoke);
    expect((await gateway.status(intent)).type).toBe("noSqlReceipt");
    expect(invoke).toHaveBeenCalledWith("agent_read_context_configuration_save_status",{request:intent});
    invoke.mockResolvedValueOnce({type:"committed",proof:{...proof,replayed:true}});
    expect((await gateway.status(intent)).type).toBe("committed");
    invoke.mockResolvedValueOnce({type:"unconfirmed",epoch:expectedEpoch,sqlFence:"0",closed:false,blocked:true,reason:"owner_blocked_receipt_unconfirmed"});
    expect((await gateway.status(intent)).type).toBe("unconfirmed");
    invoke.mockResolvedValueOnce({type:"noSqlReceipt",epoch:operationId,sqlFence:"0",closed:false});
    await expect(gateway.status(intent)).rejects.toThrow("CONTEXT_CONFIGURATION_EPOCH_MISMATCH");
    invoke.mockResolvedValueOnce({type:"committed",proof:{...proof,operationId:conversationId}});
    await expect(gateway.status(intent)).rejects.toThrow("CONTEXT_CONFIGURATION_PROOF_MISMATCH");
  });
  it("rejects invalid revisions and untrusted status shapes before relying on them",async()=>{
    const invoke=vi.fn(async()=>({type:"committed",proof:{...proof,extra:true}}));
    const gateway=createAgentContextConfigurationSaveGateway(invoke);
    await expect(gateway.save({...intent,expectedRevision:Number.MAX_SAFE_INTEGER})).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
    await expect(gateway.status(intent)).rejects.toThrow();
  });
});
