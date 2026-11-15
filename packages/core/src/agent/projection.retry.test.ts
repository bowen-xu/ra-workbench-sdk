import {expect,it} from "vitest";
import {agentTurnReconnecting,agentTurnReconnectAttempt,applyAgentEvents,createAgentConversationProjection} from "./projection";
import type {AgentEvent,AgentEventPayload} from "./events";
const conversationId="11111111-1111-4111-8111-111111111111",turnId="22222222-2222-4222-8222-222222222222",attemptId="attempt";
const model={providerId:"fixture",modelId:"fixture",revision:null};
const payloads:AgentEventPayload[]=[{type:"turnStarted",turnId,contextSnapshotId:"context",model},{type:"phaseChanged",turnId,phase:"runningModel"},{type:"modelRequestStarted",turnId,attemptId,model},{type:"modelRequestFailed",turnId,attemptId,error:"offline",retryable:true,category:"providerTemporaryUnavailable"}];
const event=(payload:AgentEventPayload,seq:number):AgentEvent=>({schemaVersion:1,conversationId,requestId:"request",seq,timestampMs:seq,payload});
it("shows reconnecting only during a live retryable failure and clears on the next attempt",()=>{
  const projection=applyAgentEvents(createAgentConversationProjection(conversationId),payloads.map((payload,index)=>event(payload,index+1)));
  expect(agentTurnReconnecting(projection.turns.get(turnId)!)).toBe(true);
  const resumed=applyAgentEvents(projection,[event({type:"modelRequestStarted",turnId,attemptId:"next",model},5)]);
  expect(agentTurnReconnecting(resumed.turns.get(turnId)!)).toBe(false);
  const failed=applyAgentEvents(projection,[event({type:"turnFinished",turnId,outcome:"failed"},5)]);
  expect(agentTurnReconnecting(failed.turns.get(turnId)!)).toBe(false);
});
it("does not present definitive rejection as reconnecting",()=>{
  const projection=applyAgentEvents(createAgentConversationProjection(conversationId),payloads.map((payload,index)=>event(payload.type==="modelRequestFailed"?{...payload,retryable:false}:payload,index+1)));
  expect(agentTurnReconnecting(projection.turns.get(turnId)!)).toBe(false);
});
it("records standalone compaction completion without fabricating a response identity",()=>{
  const started=payloads.slice(0,3).map((payload,index)=>event(payload,index+1));
  const projection=applyAgentEvents(createAgentConversationProjection(conversationId),started);
  expect(()=>applyAgentEvents(projection,[event({type:"modelRequestFinished",turnId,attemptId,inputTokens:3,outputTokens:1},4)])).toThrow();
  const completed=applyAgentEvents(projection,[event({type:"modelCompactionFinished",turnId,attemptId,inputTokens:3,outputTokens:1},4)]);
  expect(completed.turns.get(turnId)?.attempts.get(attemptId)).toMatchObject({responseId:null,actualModel:null,outcome:"completed",inputTokens:3,outputTokens:1});
  expect(()=>applyAgentEvents(completed,[event({type:"modelCompactionFinished",turnId,attemptId,inputTokens:3,outputTokens:1},5)])).toThrow();
});
it("counts reconnects within one model request and resets after successful generation", () => {
  const history: AgentEventPayload[] = payloads.slice(0,4);
  expect(agentTurnReconnectAttempt(applyAgentEvents(createAgentConversationProjection(conversationId),history.map((p,i)=>event(p,i+1))).turns.get(turnId)!)).toBe(1);
  for (let count=2; count<=5;count++) {
    history.push({type:"modelRequestStarted",turnId,attemptId:`retry-${count}`,model},
      {type:"modelRequestFailed",turnId,attemptId:`retry-${count}`,error:"offline",retryable:true,category:"providerTemporaryUnavailable"});
    const projected = applyAgentEvents(createAgentConversationProjection(conversationId),history.map((p,i)=>event(p,i+1)));
    expect(agentTurnReconnectAttempt(projected.turns.get(turnId)!)).toBe(count);
  }
  history.push({type:"modelRequestStarted",turnId,attemptId:"recovered",model},
    {type:"modelResponseStarted",turnId,attemptId:"recovered",responseId:"response",model},
    {type:"modelRequestFinished",turnId,attemptId:"recovered",inputTokens:null,outputTokens:null},
    {type:"modelRequestStarted",turnId,attemptId:"next-sample",model},
    {type:"modelRequestFailed",turnId,attemptId:"next-sample",error:"offline",retryable:true,category:"providerTemporaryUnavailable"});
  const next = applyAgentEvents(createAgentConversationProjection(conversationId),history.map((p,i)=>event(p,i+1)));
  expect(agentTurnReconnectAttempt(next.turns.get(turnId)!)).toBe(1);
});
it("resets consecutive reconnects on nonempty assistant output, before request completion", () => {
  const history: AgentEventPayload[] = [...payloads,
    {type:"modelRequestStarted",turnId,attemptId:"retry",model},
    {type:"modelRequestFailed",turnId,attemptId:"retry",error:"offline",retryable:true,category:null},
    {type:"modelRequestStarted",turnId,attemptId:"recovered",model},
    {type:"itemStarted",turnId,itemId:"answer",kind:{type:"assistantMessage"}},
    {type:"textDelta",turnId,itemId:"answer",text:""},
  ];
  const count = (events: AgentEventPayload[]) => agentTurnReconnectAttempt(applyAgentEvents(createAgentConversationProjection(conversationId), events.map((p,i)=>event(p,i+1))).turns.get(turnId)!);
  const fail = {type:"modelRequestFailed",turnId,attemptId:"recovered",error:"offline",retryable:true,category:null} as const;
  expect(count([...history, fail])).toBe(3);
  expect(count([...history, {type:"textDelta",turnId,itemId:"answer",text:"恢复输出"}, fail])).toBe(1);
});
