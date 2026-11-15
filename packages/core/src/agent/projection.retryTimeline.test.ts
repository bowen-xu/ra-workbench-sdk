import { expect, it } from "vitest";
import { decodeAgentEvent, type AgentEventPayload } from "./events";
import { applyAgentEvents, createAgentConversationProjection } from "./projection";

const conversationId = "11111111-1111-4111-8111-111111111111";
const turnId = "22222222-2222-4222-8222-222222222222";
const model = { providerId: "fixture", modelId: "fixture", revision: null };
const ids = { first: "33333333-3333-4333-8333-333333333333", second: "44444444-4444-4444-8444-444444444444",
  draft: "55555555-5555-4555-8555-555555555555", call: "66666666-6666-4666-8666-666666666666",
  tool: "77777777-7777-4777-8777-777777777777", result: "88888888-8888-4888-8888-888888888888",
  steer: "99999999-9999-4999-8999-999999999999" };
function project(payloads: readonly AgentEventPayload[]) {
  return applyAgentEvents(createAgentConversationProjection(conversationId), payloads.map((payload, index) => decodeAgentEvent({
    schemaVersion: 1, conversationId, requestId: turnId, timestampMs: 1, seq: index + 1, payload,
  })));
}
it("derives retry and item positions from durable event sequence, including late tool results and steering", () => {
  const payloads: AgentEventPayload[] = [
    {type: "turnStarted", turnId, contextSnapshotId: ids.draft, model},
    {type: "phaseChanged", turnId, phase: "runningModel"},
    {type: "modelRequestStarted", turnId, attemptId: ids.first, model},
    {type: "modelResponseStarted", turnId, attemptId: ids.first, responseId: "response", model: null},
    {type: "itemStarted", turnId, itemId: ids.draft, kind: {type: "assistantMessage"}},
    {type: "textDelta", turnId, itemId: ids.draft, text: "checking"},
    {type: "itemAccepted", turnId, itemId: ids.draft, kind: {type: "assistantMessage"}, text: "checking", phase: "commentary", source: null},
    {type: "itemAccepted", turnId, itemId: ids.tool, kind: {type: "toolCall", callId: ids.call, name: "read"}, text: "{}", phase: null, source: null},
    {type: "modelRequestFailed", turnId, attemptId: ids.first, error: "offline", retryable: true, category: null},
    {type: "itemStarted", turnId, itemId: ids.result, kind: {type: "toolResult", callId: ids.call, isError: false}},
    {type: "itemCompleted", turnId, itemId: ids.result},
    {type: "itemStarted", turnId, itemId: ids.steer, kind: {type: "userMessage"}},
    {type: "itemCompleted", turnId, itemId: ids.steer},
    {type: "modelRequestStarted", turnId, attemptId: ids.second, model},
    {type: "modelRequestFailed", turnId, attemptId: ids.second, error: "offline again", retryable: true, category: null},
  ];
  const complete = project(payloads);
  const turn = complete.turns.get(turnId)!;
  expect(turn.items.get(ids.draft)?.createdSeq).toBe(5); // completion preserves draft position
  expect(turn.items.get(ids.tool)?.createdSeq).toBe(8); // sparse itemAccepted
  expect(turn.attempts.get(ids.first)?.failedSeq).toBe(9);
  expect(turn.items.get(ids.result)?.createdSeq).toBe(10);
  expect(turn.items.get(ids.steer)?.createdSeq).toBe(12);
  expect(turn.attempts.get(ids.second)?.failedSeq).toBe(15); // no output in retry
  expect(project(payloads).turns.get(turnId)).toEqual(turn); // reopen replay is deterministic
});

it("does not infer an old draft's first event sequence from its later acceptance", () => {
  const started = project([
    {type: "turnStarted", turnId, contextSnapshotId: ids.draft, model},
    {type: "phaseChanged", turnId, phase: "runningModel"},
    {type: "itemStarted", turnId, itemId: ids.draft, kind: {type: "assistantMessage"}},
    {type: "textDelta", turnId, itemId: ids.draft, text: "draft"},
  ]);
  const turn = started.turns.get(turnId)!;
  const {createdSeq: _createdSeq, ...legacyItem} = turn.items.get(ids.draft)!;
  const legacy = {...started, turns: new Map(started.turns).set(turnId, {...turn, items: new Map(turn.items).set(ids.draft, legacyItem)})};
  const event = decodeAgentEvent({schemaVersion: 1, conversationId, requestId: turnId, timestampMs: 1, seq: 5,
    payload: {type: "itemAccepted", turnId, itemId: ids.draft, kind: {type: "assistantMessage"}, text: "draft", phase: null, source: null}});
  expect(applyAgentEvents(legacy, [event]).turns.get(turnId)?.items.get(ids.draft)?.createdSeq).toBeUndefined();
});
