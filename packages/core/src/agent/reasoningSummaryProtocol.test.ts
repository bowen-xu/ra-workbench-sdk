import { expect, it } from "vitest";
import { decodeAgentEvent, AgentEventDecodeError } from "./events";

const limit = 16 * 1024 * 1024;
const base = { schemaVersion: 1, conversationId: "11111111-1111-4111-8111-111111111111", seq: 1, timestampMs: 1,
  requestId: "22222222-2222-4222-8222-222222222222" };
const turnId = base.requestId, itemId = "33333333-3333-4333-8333-333333333333";
function accepted(parts: unknown, text: string, providerDataJson: string | null = null) {
  return { ...base, payload: { type: "itemAccepted", turnId, itemId, kind: { type: "reasoningSummary", parts }, text, phase: null,
    source: providerDataJson === null ? null : { attemptId: itemId, ordinal: 0, providerItemId: null, providerDataJson } } };
}
it("decodes sparse common summaries without requiring provider-specific JSON or canonical array indices", () => {
  const parts = [{ index: "-9223372036854775808", startByte: 0, lenByte: 3 }, { index: "9223372036854775807", startByte: 3, lenByte: 4 }];
  expect(decodeAgentEvent(accepted(parts, "思🦀")).payload).toMatchObject({ kind: { type: "reasoningSummary", parts }, text: "思🦀", phase: null, source: null });
});
it.each(["commentary", "reasoning", "finalAnswer"])("rejects phase %s on an independent summary", phase => {
  const event = accepted([], "");
  expect(() => decodeAgentEvent({ ...event, payload: { ...event.payload, phase } })).toThrow(AgentEventDecodeError);
});
it("permits only empty part metadata on item start and rejects invalid UTF-8 final spans", () => {
  expect(decodeAgentEvent({ ...base, payload: { type: "itemStarted", turnId, itemId, kind: { type: "reasoningSummary", parts: [] } } }).payload.type).toBe("itemStarted");
  expect(() => decodeAgentEvent({ ...base, payload: { type: "itemStarted", turnId, itemId, kind: { type: "reasoningSummary", parts: [{ index: "0", startByte: 0, lenByte: 0 }] } } })).toThrow();
  expect(() => decodeAgentEvent(accepted([{ index: "0", startByte: 0, lenByte: 1 }, { index: "1", startByte: 1, lenByte: 2 }], "思"))).toThrow();
});
it("keeps the existing delta Unicode-character limit and rejects unpaired surrogates", () => {
  const event = (text: string) => ({ ...base, payload: { type: "reasoningSummaryDelta", turnId, itemId, summaryIndex: "-1", text } });
  expect(decodeAgentEvent(event("🦀".repeat(65_536))).payload.type).toBe("reasoningSummaryDelta");
  for (const text of ["", "🦀".repeat(65_537), "\ud800"]) expect(() => decodeAgentEvent(event(text))).toThrow(AgentEventDecodeError);
});
it("shares the existing accepted-item metadata budget between parts JSON and native envelope", () => {
  const parts = [{ index: "0", startByte: 0, lenByte: 0 }];
  const metadataBytes = JSON.stringify(parts).length;
  const native = JSON.stringify("x".repeat(limit - metadataBytes - 2));
  expect(decodeAgentEvent(accepted(parts, "", native)).payload.type).toBe("itemAccepted");
  const tooLarge = JSON.stringify("x".repeat(limit - metadataBytes - 1));
  expect(tooLarge.length).toBeLessThan(limit);
  expect(() => decodeAgentEvent(accepted(parts, "", tooLarge))).toThrow(AgentEventDecodeError);
});
