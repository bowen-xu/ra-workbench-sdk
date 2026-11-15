import { expect, it } from "vitest";
import { decodeAgentEvent, type AgentEvent, type AgentEventPayload } from "./events";
import { applyAgentEvents, createAgentConversationProjection, type AgentConversationProjection } from "./projection";

const conversationId="11111111-1111-4111-8111-111111111111",turnId="22222222-2222-4222-8222-222222222222";
const itemId="33333333-3333-4333-8333-333333333333",attemptId="44444444-4444-4444-8444-444444444444";
const model={providerId:"fixture",modelId:"synthetic",revision:null};
const prefix:readonly [number,AgentEventPayload][]=[
  [1000,{type:"turnStarted",turnId,contextSnapshotId:itemId,model}],
  [1500,{type:"phaseChanged",turnId,phase:"runningModel"}],
  [1600,{type:"modelRequestStarted",turnId,attemptId,model}],
  [1700,{type:"modelResponseStarted",turnId,attemptId,responseId:"synthetic",model:null}],
];
const canonical:AgentEventPayload={type:"itemAccepted",turnId,itemId,kind:{type:"assistantMessage"},text:"Corrected final answer",phase:"finalAnswer",
  source:{attemptId,ordinal:0,providerItemId:"synthetic-message",providerDataJson:null}};
function events(entries:readonly (readonly [number,AgentEventPayload])[]):readonly AgentEvent[]{
  return entries.map(([timestampMs,payload],index)=>decodeAgentEvent({schemaVersion:1,conversationId,requestId:turnId,seq:index+1,timestampMs,payload}));
}
function replay(history:readonly AgentEvent[]){return applyAgentEvents(createAgentConversationProjection(conversationId),history);}
function item(state:AgentConversationProjection){
  const value=state.turns.get(turnId)?.items.get(itemId);if(!value)throw new Error("Missing timed synthetic item");return value;
}
function stream(){return events([...prefix,
  [1800,{type:"itemStarted",turnId,itemId,kind:{type:"assistantMessage"}}],
  [1900,{type:"itemPhaseChanged",turnId,itemId,phase:"commentary",native:true}],
  [2100,{type:"textDelta",turnId,itemId,text:"Streaming draft"}],
  [4000,canonical],
  [4100,{type:"modelRequestFinished",turnId,attemptId,inputTokens:null,outputTokens:null}],
  [4200,{type:"turnFinished",turnId,outcome:"completed"}],
]);}

it("preserves the first streamed event time through native canonical text and phase correction and cold replay",()=>{
  const history=stream(),draft=replay(history.slice(0,7)),complete=applyAgentEvents(draft,history.slice(7));
  expect(item(draft)).toMatchObject({createdAtMs:1800,text:"Streaming draft",phase:"commentary",completed:false});
  expect(item(complete)).toMatchObject({createdAtMs:1800,text:"Corrected final answer",phase:"finalAnswer",accepted:true,completed:true,
    source:{attemptId,ordinal:0,providerItemId:"synthetic-message"}});
  const cold=replay((JSON.parse(JSON.stringify(history)) as unknown[]).map(decodeAgentEvent));
  expect(item(cold)).toEqual(item(complete));
  expect(applyAgentEvents(complete,history)).toBe(complete);
});

it("uses the durable atomic acceptance time when the item has no streamed draft",()=>{
  const history=events([...prefix,[4000,canonical],
    [4100,{type:"modelRequestFinished",turnId,attemptId,inputTokens:null,outputTokens:null}],
    [4200,{type:"turnFinished",turnId,outcome:"completed"}],
  ]);
  expect(item(replay(history))).toMatchObject({createdAtMs:4000,text:"Corrected final answer",phase:"finalAnswer",accepted:true});
});

it("retains unknown first time in older cached drafts instead of borrowing the later completion time",()=>{
  const history=stream(),draft=replay(history.slice(0,7)),turn=draft.turns.get(turnId);
  if(!turn)throw new Error("Missing synthetic turn");
  const legacy={...item(draft)};delete legacy.createdAtMs;
  const cached={...draft,turns:new Map(draft.turns).set(turnId,{...turn,items:new Map(turn.items).set(itemId,legacy)})};
  expect(item(applyAgentEvents(cached,history.slice(7)))).not.toHaveProperty("createdAtMs");
});
