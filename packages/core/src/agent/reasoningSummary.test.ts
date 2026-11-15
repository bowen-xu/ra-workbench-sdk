import { expect, it } from "vitest";
import { agentReasoningSummaryParts, decodeAgentReasoningSummaryIndex } from "./reasoningSummary";

it.each(["-9223372036854775808", "9223372036854775807", "9007199254740993", "-1", "0"])("preserves the exact i64 index %s", index => {
  expect(decodeAgentReasoningSummaryIndex(index)).toBe(index);
});
it.each(["9223372036854775808", "-9223372036854775809", "01", "-0", "+1", " 1", "1.0", "1e3", 0, 9007199254740992, null])("rejects noncanonical or out-of-range index %j", index => {
  expect(() => decodeAgentReasoningSummaryIndex(index)).toThrow();
});
it("recovers Unicode and empty canonical parts with byte spans", () => {
  expect(agentReasoningSummaryParts("思考🦀done", [
    { index: "0", startByte: 0, lenByte: 6 }, { index: "1", startByte: 6, lenByte: 0 },
    { index: "2", startByte: 6, lenByte: 4 }, { index: "3", startByte: 10, lenByte: 4 },
  ])).toEqual([{ index: "0", text: "思考" }, { index: "1", text: "" }, { index: "2", text: "🦀" }, { index: "3", text: "done" }]);
});
it.each([
  { parts: [{ index: "0", startByte: 0, lenByte: 1 }] },
  { parts: [{ index: "0", startByte: 1, lenByte: 2 }] },
  { parts: [{ index: "-1", startByte: 0, lenByte: 0 }, { index: "-1", startByte: 0, lenByte: 3 }] },
  { parts: [{ index: "0", startByte: 0, lenByte: 0 }] },
])("rejects gaps, split UTF-8 characters, duplicate indices and missing coverage", ({ parts }) => {
  expect(() => agentReasoningSummaryParts("思", parts)).toThrow();
});
it("keeps valid signed indices independent of adapter-specific array positions", () => {
  expect(agentReasoningSummaryParts("思", [{ index: "-9223372036854775808", startByte: 0, lenByte: 3 }])).toEqual([
    { index: "-9223372036854775808", text: "思" },
  ]);
});
