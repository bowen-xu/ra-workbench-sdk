import { AgentCatalogDecodeError } from "./catalog";
import { catalogObject } from "./catalog-decoding";
import { agentSqlFence, catalogOperationBoolean, catalogOperationId, catalogOperationReason } from "./catalogOperationDecoding";
import { decodeAgentContextState, type AgentContextState } from "./contextSelection";

export const AGENT_CONTEXT_CONFIGURATION_SAVE_FAMILY = "agent.context.configuration.save";
export interface AgentContextConfigurationSaveIntent {
  readonly operationId: string; readonly conversationId: string; readonly expectedEpoch: string;
  readonly expectedRevision: number; readonly state: AgentContextState;
}
export interface AgentContextConfigurationSaveProof {
  readonly schemaVersion: 1; readonly operationId: string; readonly conversationId: string;
  readonly family: typeof AGENT_CONTEXT_CONFIGURATION_SAVE_FAMILY; readonly epoch: string;
  readonly sqlFence: string; readonly replayed: boolean; readonly result: null;
}
export interface AgentContextConfigurationEnvironmentRequest {readonly operationId:string; readonly conversationId:string}
export interface AgentContextConfigurationEnvironment extends AgentContextConfigurationEnvironmentRequest {
  readonly schemaVersion:1; readonly epoch:string; readonly sqlFence:string;
  readonly configuration:{readonly revision:number;readonly state:AgentContextState}|null;
}
export type AgentContextConfigurationSaveStatus =
  | {readonly type: "committed"; readonly proof: AgentContextConfigurationSaveProof}
  | {readonly type: "noSqlReceipt"; readonly epoch: string; readonly sqlFence: string; readonly closed: boolean}
  | {readonly type: "unconfirmed"; readonly epoch: string; readonly sqlFence: string; readonly blocked: boolean; readonly closed: boolean; readonly reason: string};

function fail(): never { throw new AgentCatalogDecodeError(); }
export function decodeAgentContextConfigurationEnvironmentRequest(value:unknown):AgentContextConfigurationEnvironmentRequest {
  const row=catalogObject(value,["operationId","conversationId"]);
  return {operationId:catalogOperationId(row.operationId),conversationId:catalogOperationId(row.conversationId)};
}
export function decodeAgentContextConfigurationEnvironment(value:unknown):AgentContextConfigurationEnvironment {
  const row=catalogObject(value,["schemaVersion","operationId","conversationId","epoch","sqlFence","configuration"]);
  if(row.schemaVersion!==1 || !Object.hasOwn(row,"configuration"))return fail();
  let configuration:AgentContextConfigurationEnvironment["configuration"]=null;
  if(row.configuration!==null){
    const saved=catalogObject(row.configuration,["revision","state"]);
    if(typeof saved.revision!=="number" || !Number.isSafeInteger(saved.revision) || saved.revision<1)return fail();
    configuration={revision:saved.revision,state:decodeAgentContextState(saved.state)};
  }
  return {schemaVersion:1,operationId:catalogOperationId(row.operationId),conversationId:catalogOperationId(row.conversationId),
    epoch:catalogOperationId(row.epoch),sqlFence:agentSqlFence(row.sqlFence),configuration};
}
export function decodeAgentContextConfigurationSaveIntent(value: unknown): AgentContextConfigurationSaveIntent {
  const row = catalogObject(value, ["operationId", "conversationId", "expectedEpoch", "expectedRevision", "state"]);
  if (typeof row.expectedRevision !== "number" || !Number.isSafeInteger(row.expectedRevision) || row.expectedRevision < 0 || row.expectedRevision >= Number.MAX_SAFE_INTEGER) return fail();
  return {operationId:catalogOperationId(row.operationId),conversationId:catalogOperationId(row.conversationId),
    expectedEpoch:catalogOperationId(row.expectedEpoch),expectedRevision:row.expectedRevision,state:decodeAgentContextState(row.state)};
}
export function decodeAgentContextConfigurationSaveProof(value: unknown): AgentContextConfigurationSaveProof {
  const row = catalogObject(value, ["schemaVersion", "operationId", "conversationId", "family", "epoch", "sqlFence", "replayed", "result"]);
  if (row.schemaVersion !== 1 || row.family !== AGENT_CONTEXT_CONFIGURATION_SAVE_FAMILY || row.result !== null) return fail();
  return {schemaVersion:1,operationId:catalogOperationId(row.operationId),conversationId:catalogOperationId(row.conversationId),
    family:AGENT_CONTEXT_CONFIGURATION_SAVE_FAMILY,epoch:catalogOperationId(row.epoch),sqlFence:agentSqlFence(row.sqlFence),
    replayed:catalogOperationBoolean(row.replayed),result:null};
}
export function decodeAgentContextConfigurationSaveStatus(value: unknown): AgentContextConfigurationSaveStatus {
  const row = catalogObject(value, ["type", "proof", "epoch", "sqlFence", "closed", "blocked", "reason"]);
  switch (row.type) {
    case "committed": catalogObject(row,["type","proof"]); return {type:row.type,proof:decodeAgentContextConfigurationSaveProof(row.proof)};
    case "noSqlReceipt": catalogObject(row,["type","epoch","sqlFence","closed"]); return {type:row.type,epoch:catalogOperationId(row.epoch),sqlFence:agentSqlFence(row.sqlFence),closed:catalogOperationBoolean(row.closed)};
    case "unconfirmed": catalogObject(row,["type","epoch","sqlFence","closed","blocked","reason"]); return {type:row.type,epoch:catalogOperationId(row.epoch),sqlFence:agentSqlFence(row.sqlFence),closed:catalogOperationBoolean(row.closed),blocked:catalogOperationBoolean(row.blocked),reason:catalogOperationReason(row.reason)};
    default: return fail();
  }
}
