import { describe, expect, it } from "vitest";
import { decodeAgentHistoryResponse, decodeAgentSessionResponse } from "../../packages/core/src/agent";
import fixture from "../fixtures/agent-history-v1.json";
describe("agent session IPC", () => {
  it("preserves a native snapshot token and rejects invalid identities", () => {
    const snapshotId = "00000000-0000-4000-8000-000000000088";
    expect(decodeAgentHistoryResponse({ ...fixture, snapshotId }).snapshotId).toBe(snapshotId);
    for (const snapshotId of [null, "", "invalid", "00000000-0000-0000-0000-000000000000"])
      expect(() => decodeAgentHistoryResponse({ ...fixture, snapshotId })).toThrow();
  });
  it("matches native history and session acknowledgements", () => {
    expect(decodeAgentHistoryResponse(fixture)).toEqual(fixture);
    const session = { schemaVersion: 1, conversationId: fixture.conversationId, watermark: fixture.watermark };
    expect(decodeAgentSessionResponse(session)).toEqual(session);
  });
  it("rejects gaps, mixed conversations, impossible cursors and unsafe counts", () => {
    for (const patch of [{ events: fixture.events.slice(1) }, { conversationId: "00000000-0000-0000-0000-000000000000" },
      { nextAfterSeq: 0 }, { afterSeq: 999 }, { watermark: Number.MAX_SAFE_INTEGER + 1 }, { schemaVersion: 2 }, { extra: true }]) {
      expect(() => decodeAgentHistoryResponse({ ...fixture, ...patch })).toThrow();
    }
  });
  it("accepts empty terminal pages but rejects empty pages that cannot advance", () => {
    expect(decodeAgentHistoryResponse({ ...fixture, afterSeq: fixture.watermark, events: [], nextAfterSeq: null }).events).toEqual([]);
    expect(() => decodeAgentHistoryResponse({ ...fixture, events: [], nextAfterSeq: 0 })).toThrow();
  });
});

import waits from "../fixtures/agent-history-wait-v1.json";
import { decodeAgentHistoryWaitResponse } from "../../packages/core/src/agent";
it("decodes native change/timeout notices and rejects stale or unsafe watermarks", () => {
  expect(waits.map(decodeAgentHistoryWaitResponse)).toEqual(waits);
  for (const watermark of [3, 2, -1, Number.MAX_SAFE_INTEGER + 1]) {
    expect(() => decodeAgentHistoryWaitResponse({ ...waits[0], watermark })).toThrow();
  }
});

it("decodes accepted event batches and explicit resync while rejecting mixed or missing ranges", () => {
  const accepted = {schemaVersion:1,conversationId:fixture.conversationId,afterSeq:0,
    watermark:fixture.watermark,events:fixture.events,resyncRequired:false};
  expect(decodeAgentHistoryWaitResponse(accepted)).toEqual(accepted);
  expect(decodeAgentHistoryWaitResponse({...accepted,watermark:null,events:[],resyncRequired:true}).resyncRequired).toBe(true);
  for (const patch of [{events:fixture.events.slice(1)},{resyncRequired:true},{events:[]},{resyncRequired:"yes"},
    {conversationId:"00000000-0000-0000-0000-000000000000"},{watermark:null}]) {
    expect(()=>decodeAgentHistoryWaitResponse({...accepted,...patch})).toThrow();
  }
});
