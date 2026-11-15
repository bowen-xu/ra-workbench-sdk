import { describe, expect, it, vi } from "vitest";
import { createAgentSessionGateway, startAgentHistoryFeed } from "../../packages/data/src/agent";
import { AgentSessionDecodeError, decodeAgentEvent, type AgentHistoryResponse, type AgentHistoryWaitResponse } from "../../packages/core/src/agent";
import raw from "../fixtures/agent-events-v1.json";
const events = raw.map(decodeAgentEvent);
const conversationId = events[0].conversationId;
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function page(afterSeq: number, end: number, watermark: number): AgentHistoryResponse {
  return { schemaVersion: 1, conversationId, afterSeq, events: events.slice(afterSeq, end), watermark, nextAfterSeq: end < watermark ? end : null };
}

describe("shared agent history feed", () => {
  it("signals readiness only after the complete snapshot and pauses it during resync", async () => {
    const second = deferred<AgentHistoryResponse>(), secondEntered = deferred<void>(), resync = deferred<AgentHistoryResponse>(), resyncEntered = deferred<void>();
    const states: boolean[] = [];
    const gateway = {
      readHistory: vi.fn().mockResolvedValueOnce(page(0, 3, 6))
        .mockImplementationOnce(() => { secondEntered.resolve(); return second.promise; })
        .mockImplementationOnce(() => { resyncEntered.resolve(); return resync.promise; }),
      waitForHistory: vi.fn().mockResolvedValueOnce({schemaVersion:1,conversationId,afterSeq:6,watermark:7,events:[],resyncRequired:true})
        .mockImplementationOnce(() => new Promise(() => {})),
    };
    const feed = startAgentHistoryFeed(gateway, {conversationId,afterSeq:0,onBatch() {},onSyncState:state=>states.push(state)});
    await secondEntered.promise;expect(states).toEqual([false]);
    second.resolve(page(3,6,6));await resyncEntered.promise;expect(states).toEqual([false,true,false]);
    resync.resolve(page(6,7,7));await vi.waitFor(()=>expect(states).toEqual([false,true,false,true]));
    feed.stop();expect(await feed.done).toBe(7);
  });
  it("uses the same frozen snapshot token across all bootstrap pages", async () => {
    const snapshotId = "00000000-0000-4000-8000-000000000088";
    const gateway = {
      readHistory: vi.fn().mockResolvedValueOnce({ ...page(0, 3, 7), snapshotId })
        .mockResolvedValueOnce({ ...page(3, 6, 7), snapshotId })
        .mockResolvedValueOnce({ ...page(6, 7, 7), snapshotId }),
      waitForHistory: vi.fn(),
    };
    const feed = startAgentHistoryFeed(gateway, { conversationId, afterSeq: 0, onBatch(batch) {
      if (batch.at(-1)?.seq === 7) feed.stop();
    } });
    expect(await feed.done).toBe(7);
    expect(gateway.readHistory.mock.calls.map(([request]) => request)).toEqual([
      { conversationId, afterSeq: 0, limit: 100 },
      { conversationId, afterSeq: 3, limit: 4, snapshotId },
      { conversationId, afterSeq: 6, limit: 1, snapshotId },
    ]);
    expect(gateway.waitForHistory).not.toHaveBeenCalled();
  });

  it("rejects a replaced snapshot without accepting its newer page", async () => {
    const gateway = {
      readHistory: vi.fn().mockResolvedValueOnce({ ...page(0, 3, 6), snapshotId: "00000000-0000-4000-8000-000000000088" })
        .mockResolvedValueOnce({ ...page(3, 6, 6), snapshotId: "00000000-0000-4000-8000-000000000089" }),
      waitForHistory: vi.fn(),
    };
    const seen: number[] = [];
    const feed = startAgentHistoryFeed(gateway, { conversationId, afterSeq: 0,
      onBatch(batch) { seen.push(...batch.map(event => event.seq)); } });
    await expect(feed.done).rejects.toThrow(AgentSessionDecodeError);
    expect(feed.afterSeq).toBe(3);
    expect(seen).toEqual([1, 2, 3]);
  });

  it("keeps concurrent subscriptions isolated and rejects a response for another conversation", async () => {
    const otherId = "00000000-0000-4000-8000-000000000099";
    const firstRead = deferred<AgentHistoryResponse>();
    const secondRead = deferred<AgentHistoryResponse>();
    const firstBatch = vi.fn();
    const secondBatch = vi.fn();
    const waitForHistory = vi.fn();
    const first = startAgentHistoryFeed({ readHistory: () => firstRead.promise, waitForHistory }, { conversationId, afterSeq: 0, onBatch: firstBatch });
    const second = startAgentHistoryFeed({ readHistory: () => secondRead.promise, waitForHistory }, { conversationId: otherId, afterSeq: 0, onBatch: secondBatch });
    first.stop();
    expect(await first.done).toBe(0);
    const rejected = expect(second.done).rejects.toThrow(AgentSessionDecodeError);
    secondRead.resolve(page(0, 3, 3));
    await rejected;
    firstRead.resolve(page(0, 3, 3));
    await Promise.resolve();
    expect(firstBatch).not.toHaveBeenCalled();
    expect(secondBatch).not.toHaveBeenCalled();
    expect(second.afterSeq).toBe(0);
    expect(waitForHistory).not.toHaveBeenCalled();
  });

  it("surfaces a transport failure and lets the caller resume from the applied cursor", async () => {
    const seen: number[] = [];
    const failed = startAgentHistoryFeed({
      readHistory: async () => page(0, 3, 3),
      waitForHistory: async () => { throw new Error("disconnected"); },
    }, { conversationId, afterSeq: 0, onBatch: (batch) => { seen.push(...batch.map((event) => event.seq)); } });
    await expect(failed.done).rejects.toThrow("disconnected");
    expect(failed.afterSeq).toBe(3);
    const readHistory = vi.fn(async () => page(3, 6, 6));
    const resumed = startAgentHistoryFeed({ readHistory, waitForHistory: vi.fn() }, {
      conversationId, afterSeq: failed.afterSeq,
      onBatch: (batch) => { seen.push(...batch.map((event) => event.seq)); resumed.stop(); },
    });
    expect(await resumed.done).toBe(6);
    expect(readHistory).toHaveBeenCalledWith({ conversationId, afterSeq: 3, limit: 100 });
    expect(seen).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("drains pages before waiting, then resumes at the last applied event", async () => {
    const waiting = deferred<void>();
    const change = deferred<AgentHistoryWaitResponse>();
    const gateway = {
      readHistory: vi.fn().mockResolvedValueOnce(page(0, 3, 6)).mockResolvedValueOnce(page(3, 6, 6)).mockResolvedValueOnce(page(6, 7, 7)),
      waitForHistory: vi.fn(() => { waiting.resolve(); return change.promise; }),
    };
    const seen: number[] = [];
    const feed = startAgentHistoryFeed(gateway, { conversationId, afterSeq: 0, onBatch(batch) {
      seen.push(...batch.map((event) => event.seq));
      if (seen.length === 7) feed.stop();
    } });
    await waiting.promise;
    expect(feed.afterSeq).toBe(6);
    expect(gateway.waitForHistory).toHaveBeenCalledWith({ conversationId, afterSeq: 6, waitMs: 30_000 }, expect.any(AbortSignal));
    change.resolve({ schemaVersion: 1, conversationId, afterSeq: 6, watermark: 7 });
    expect(await feed.done).toBe(7);
    expect(seen).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(gateway.readHistory.mock.calls.map(([request]) => request.afterSeq)).toEqual([0, 3, 6]);
  });

  it("stop ignores late read resolution and late wait rejection", async () => {
    const read = deferred<AgentHistoryResponse>();
    const onBatch = vi.fn();
    const waitForHistory = vi.fn();
    const first = startAgentHistoryFeed({ readHistory: () => read.promise, waitForHistory }, { conversationId, afterSeq: 0, onBatch });
    first.stop();
    expect(await first.done).toBe(0);
    read.resolve(page(0, 3, 3));
    await Promise.resolve();
    expect(onBatch).not.toHaveBeenCalled();
    expect(waitForHistory).not.toHaveBeenCalled();

    const waiting = deferred<void>();
    const late = deferred<AgentHistoryWaitResponse>();
    const second = startAgentHistoryFeed({ readHistory: async () => page(0, 3, 3), waitForHistory: () => { waiting.resolve(); return late.promise; } }, { conversationId, afterSeq: 0, onBatch });
    await waiting.promise;
    second.stop();
    expect(await second.done).toBe(3);
    late.reject(new Error("late transport failure"));
    await Promise.resolve();
    expect(onBatch).toHaveBeenCalledTimes(1);
  });

  it("cancels the in-flight history wait when detached and resumes from the applied cursor", async () => {
    const waiting = deferred<void>();
    let waitSignal: AbortSignal | undefined;
    const invoke = vi.fn((command: string, _args: Record<string, unknown>, options?: {signal?: AbortSignal}): Promise<unknown> => {
      if (command === "agent_read_history") return Promise.resolve(page(0, 3, 3));
      if (command !== "agent_wait_for_history") throw new Error(`unexpected command ${command}`);
      waitSignal = options?.signal;
      waiting.resolve();
      return new Promise((_resolve, reject) => {
        waitSignal?.addEventListener("abort", () => reject(new Error("aborted")), {once: true});
      });
    });
    const seen: number[] = [];
    const feed = startAgentHistoryFeed(createAgentSessionGateway(invoke), {
      conversationId, afterSeq: 0, onBatch(batch) { seen.push(...batch.map(event => event.seq)); },
    });
    await waiting.promise;
    expect(waitSignal?.aborted).toBe(false);
    feed.stop();
    expect(waitSignal?.aborted).toBe(true);
    expect(await feed.done).toBe(3);
    expect(seen).toEqual([1, 2, 3]);
    expect(invoke.mock.calls[0][2]).toBeUndefined();

    const resumed = startAgentHistoryFeed({readHistory: async () => page(3, 6, 6), waitForHistory: vi.fn()}, {
      conversationId, afterSeq: feed.afterSeq,
      onBatch(batch) { seen.push(...batch.map(event => event.seq)); resumed.stop(); },
    });
    expect(await resumed.done).toBe(6);
    expect(seen).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("awaits accepted batches and does not advance when application fails", async () => {
    const entered = deferred<void>();
    const apply = deferred<void>();
    const gateway = { readHistory: vi.fn(async () => page(0, 3, 3)), waitForHistory: vi.fn() };
    const feed = startAgentHistoryFeed(gateway, { conversationId, afterSeq: 0, onBatch: () => { entered.resolve(); return apply.promise; } });
    await entered.promise;
    feed.stop();
    expect(feed.afterSeq).toBe(0);
    expect(gateway.waitForHistory).not.toHaveBeenCalled();
    apply.resolve();
    expect(await feed.done).toBe(3);
    const failed = startAgentHistoryFeed(gateway, { conversationId, afterSeq: 0, onBatch: () => { throw new Error("apply failed"); } });
    await expect(failed.done).rejects.toThrow("apply failed");
    expect(failed.afterSeq).toBe(0);
  });

  it("applies native accepted batches without reading history for every update", async () => {
    const waits = [
      {schemaVersion:1 as const,conversationId,afterSeq:3,watermark:5,events:events.slice(3,5),resyncRequired:false},
      {schemaVersion:1 as const,conversationId,afterSeq:5,watermark:7,events:events.slice(5,7),resyncRequired:false},
    ];
    const gateway={readHistory:vi.fn(async()=>page(0,3,3)),waitForHistory:vi.fn(async()=>waits.shift()!)};
    const seen:number[]=[];
    const feed=startAgentHistoryFeed(gateway,{conversationId,afterSeq:0,onBatch(batch){seen.push(...batch.map(event=>event.seq));if(seen.length===7)feed.stop();}});
    expect(await feed.done).toBe(7);
    expect(gateway.readHistory).toHaveBeenCalledTimes(1);
    expect(gateway.waitForHistory.mock.calls.map(([request])=>request.afterSeq)).toEqual([3,5]);
    expect(seen).toEqual([1,2,3,4,5,6,7]);
  });

  it("freezes the first catchup watermark and takes the newer tail from accepted events", async () => {
    const gateway={readHistory:vi.fn().mockResolvedValueOnce(page(0,3,6)).mockResolvedValueOnce(page(3,7,7)),
      waitForHistory:vi.fn(async()=>({schemaVersion:1 as const,conversationId,afterSeq:6,watermark:7,events:events.slice(6,7),resyncRequired:false}))};
    const batches:number[][]=[];
    const feed=startAgentHistoryFeed(gateway,{conversationId,afterSeq:0,onBatch(batch){batches.push(batch.map(event=>event.seq));if(batch.at(-1)?.seq===7)feed.stop();}});
    expect(await feed.done).toBe(7);
    expect(batches).toEqual([[1,2,3],[4,5,6],[7]]);
    expect(gateway.readHistory.mock.calls.map(([request])=>request.limit)).toEqual([100,3]);
    expect(gateway.waitForHistory).toHaveBeenCalledWith({conversationId,afterSeq:6,waitMs:30_000}, expect.any(AbortSignal));
  });

  it("uses one SQL resync for an explicit accepted-cache gap", async () => {
    const gateway={readHistory:vi.fn().mockResolvedValueOnce(page(0,3,3)).mockResolvedValueOnce(page(3,6,6)),
      waitForHistory:vi.fn().mockResolvedValueOnce({schemaVersion:1,conversationId,afterSeq:3,watermark:6,events:[],resyncRequired:true})};
    const feed=startAgentHistoryFeed(gateway,{conversationId,afterSeq:0,onBatch(batch){if(batch.at(-1)?.seq===6)feed.stop();}});
    expect(await feed.done).toBe(6);
    expect(gateway.readHistory.mock.calls.map(([request])=>request.afterSeq)).toEqual([0,3]);
  });

  it("rejects native sequence gaps and acknowledges only after applying an accepted batch", async () => {
    const apply=deferred<void>(),entered=deferred<void>();
    const gateway={readHistory:vi.fn(async()=>page(0,3,3)),waitForHistory:vi.fn(async()=>({schemaVersion:1 as const,conversationId,afterSeq:3,watermark:6,events:events.slice(3,6),resyncRequired:false}))};
    const feed=startAgentHistoryFeed(gateway,{conversationId,afterSeq:0,onBatch(batch){if(batch[0].seq===4){entered.resolve();return apply.promise;}}});
    await entered.promise; expect(feed.afterSeq).toBe(3); feed.stop(); apply.resolve();
    expect(await feed.done).toBe(6);
    const bad=startAgentHistoryFeed({...gateway,waitForHistory:async()=>({schemaVersion:1 as const,conversationId,afterSeq:3,watermark:6,events:events.slice(4,6),resyncRequired:false})},{conversationId,afterSeq:0,onBatch(){}});
    await expect(bad.done).rejects.toThrow(AgentSessionDecodeError); expect(bad.afterSeq).toBe(3);
  });
});
