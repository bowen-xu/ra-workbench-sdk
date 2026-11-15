import { catalogBinding } from "./catalog-decoding";
import { catalogOperationId, agentSqlFence } from "./catalogOperationDecoding";
import { decodeAgentQueueEditScope, type AgentQueueEditScope } from "./queueEditIntent";
import { decodeAgentRequestUserInput } from "./requestUserInput";
import { AgentSubmissionDecodeError, decodeAgentQueuedText } from "./submission";
import type { AgentConversationBinding } from "./catalog";
import type { AgentUserInput } from "./userInput";

export type AgentSteeringHandoffFamily = "agent.steering.handoff.prepare" | "agent.steering.handoff.finish" | "agent.steering.handoff.release" | "agent.steering.handoff.cancel";
export interface AgentSteeringHandoffIntent {
  readonly operationId: string; readonly conversationId: string; readonly turnId: string;
  readonly steeringInputId: string; readonly queueInputId: string; readonly expectedRevision: number;
  readonly expectedEpoch: string | null; readonly scope: AgentQueueEditScope; readonly queueIndex: number;
  readonly queuePaused: boolean; readonly inputPaused: boolean; readonly origin: AgentConversationBinding | null;
  readonly text: string; readonly userInput: readonly AgentUserInput[];
}
export interface AgentSteeringHandoffProof {
  readonly schemaVersion: 1; readonly operationId: string; readonly conversationId: string;
  readonly family: AgentSteeringHandoffFamily; readonly epoch: string; readonly sqlFence: string;
  readonly replayed: boolean; readonly result: null;
}
export interface AgentSteeringHandoffPage {
  readonly schemaVersion: 1; readonly conversationId: string; readonly epoch: string;
  readonly items: readonly {readonly intent: AgentSteeringHandoffIntent; readonly proof: AgentSteeringHandoffProof;
    readonly history: "unconfirmed" | "confirmed" | "incompleteOrConflicting"}[];
}
function fail(): never { throw new AgentSubmissionDecodeError(); }
function fields(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some(key => !keys.includes(key)) || keys.some(key => !Object.hasOwn(row, key))) return fail();
  return row;
}
export function decodeAgentSteeringHandoffIntent(value: unknown): AgentSteeringHandoffIntent {
  const row = fields(value, ["operationId","conversationId","turnId","steeringInputId","queueInputId","expectedRevision",
    "expectedEpoch","scope","queueIndex","queuePaused","inputPaused","origin","text","userInput"]);
  const conversationId = catalogOperationId(row.conversationId);
  if (typeof row.expectedRevision !== "number" || !Number.isSafeInteger(row.expectedRevision) || row.expectedRevision < 0 || row.expectedRevision >= Number.MAX_SAFE_INTEGER
    || typeof row.queueIndex !== "number" || !Number.isInteger(row.queueIndex) || row.queueIndex < 0 || row.queueIndex > 255
    || typeof row.queuePaused !== "boolean" || typeof row.inputPaused !== "boolean") return fail();
  const text = decodeAgentQueuedText(row.text);
  return {operationId:catalogOperationId(row.operationId), conversationId, turnId:catalogOperationId(row.turnId),
    steeringInputId:catalogOperationId(row.steeringInputId), queueInputId:catalogOperationId(row.queueInputId),
    expectedRevision:row.expectedRevision, expectedEpoch:row.expectedEpoch === null ? null : catalogOperationId(row.expectedEpoch),
    scope:decodeAgentQueueEditScope(row.scope,conversationId), queueIndex:row.queueIndex, queuePaused:row.queuePaused,
    inputPaused:row.inputPaused, origin:row.origin === null ? null : catalogBinding(row.origin), text,
    userInput:decodeAgentRequestUserInput(row.userInput,text)};
}
export function decodeAgentSteeringHandoffProof(value: unknown, family: AgentSteeringHandoffFamily): AgentSteeringHandoffProof {
  const row=fields(value,["schemaVersion","operationId","conversationId","family","epoch","sqlFence","replayed","result"]);
  if(row.schemaVersion!==1 || row.family!==family || row.result!==null || typeof row.replayed!=="boolean")return fail();
  return {schemaVersion:1,operationId:catalogOperationId(row.operationId),conversationId:catalogOperationId(row.conversationId),
    family,epoch:catalogOperationId(row.epoch),sqlFence:agentSqlFence(row.sqlFence),replayed:row.replayed,result:null};
}
export function decodeAgentSteeringHandoffPage(value: unknown, conversation: string, expectedEpoch?: string): AgentSteeringHandoffPage {
  const row=fields(value,["schemaVersion","conversationId","epoch","items"]);
  const conversationId=catalogOperationId(conversation), epoch=catalogOperationId(row.epoch);
  if(row.schemaVersion!==1 || catalogOperationId(row.conversationId)!==conversationId || expectedEpoch && epoch!==catalogOperationId(expectedEpoch)
    || !Array.isArray(row.items) || row.items.length>64)return fail();
  const steeringIds=new Set<string>(),queueIds=new Set<string>(),operations=new Set<string>();
  const items=row.items.map((raw):AgentSteeringHandoffPage["items"][number]=>{
    const item=fields(raw,["intent","proof","history"]), intent=decodeAgentSteeringHandoffIntent(item.intent);
    const proof=decodeAgentSteeringHandoffProof(item.proof,"agent.steering.handoff.prepare");
    if(intent.conversationId!==conversationId || intent.expectedEpoch!==null && intent.expectedEpoch!==epoch
      || proof.conversationId!==conversationId || proof.epoch!==epoch || proof.operationId!==intent.operationId
      || steeringIds.has(intent.steeringInputId) || queueIds.has(intent.queueInputId) || operations.has(intent.operationId)
      || item.history!=="unconfirmed" && item.history!=="confirmed" && item.history!=="incompleteOrConflicting")return fail();
    steeringIds.add(intent.steeringInputId);queueIds.add(intent.queueInputId);operations.add(intent.operationId);
    return {intent,proof,history:item.history};
  });
  return {schemaVersion:1,conversationId,epoch,items};
}
