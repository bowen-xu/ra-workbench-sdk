import { expect, it } from "vitest";
import { decodeAgentEvent } from "./events";

const limit = 16 * 1024 * 1024;
const base = { schemaVersion: 1, conversationId: "11111111-1111-4111-8111-111111111111", seq: 1, timestampMs: 1,
  requestId: "22222222-2222-4222-8222-222222222222" };
const turnId = base.requestId, itemId = "33333333-3333-4333-8333-333333333333";
function event(namespace: string, completed = false, providerDataJson: string | null = null) {
  const common = { turnId, itemId, kind: { type: "toolCall", callId: itemId, name: "research_list_sources", namespace } };
  return { ...base, payload: completed ? { ...common, type: "itemAccepted", text: "{}", phase: null,
    source: providerDataJson === null ? null : { attemptId: itemId, ordinal: 0, providerItemId: null, providerDataJson } }
    : { ...common, type: "itemStarted" } };
}

it("counts NUL JSON escaping and quote overhead at the existing namespace metadata boundary", () => {
  const count = Math.floor((limit - 2) / 6);
  const namespace = "\0".repeat(count) + "x".repeat(limit - 2 - count * 6);
  // This encoded JSON contains only ASCII, so its length is its UTF-8 size.
  expect(JSON.stringify(namespace).length).toBe(limit);
  expect(namespace.length).toBeLessThan(limit);
  for (const completed of [false, true]) {
    expect(decodeAgentEvent(event(namespace, completed)).payload.type).toBe(completed ? "itemAccepted" : "itemStarted");
    expect(() => decodeAgentEvent(event(namespace + "x", completed))).toThrow();
  }
});

it("counts multibyte Unicode by encoded UTF-8 bytes rather than characters", () => {
  const count = Math.floor((limit - 2) / 4);
  const namespace = "🦀".repeat(count) + "x".repeat(limit - 2 - count * 4);
  expect(namespace.length).toBeLessThan(limit);
  expect(decodeAgentEvent(event(namespace)).payload.type).toBe("itemStarted");
  expect(() => decodeAgentEvent(event(namespace + "x"))).toThrow();
});

it("shares the existing completed-item metadata budget with raw provider JSON", () => {
  const namespace = "命".repeat(300), namespaceBytes = 300 * 3 + 2;
  const providerBytes = limit - namespaceBytes;
  const providerDataJson = JSON.stringify("x".repeat(providerBytes - 2));
  expect(providerDataJson.length + namespaceBytes).toBe(limit);
  expect(decodeAgentEvent(event(namespace, true, providerDataJson)).payload.type).toBe("itemAccepted");
  const oversized = JSON.stringify("x".repeat(providerBytes - 1));
  expect(oversized.length).toBeLessThan(limit);
  expect(() => decodeAgentEvent(event(namespace, true, oversized))).toThrow();
});
