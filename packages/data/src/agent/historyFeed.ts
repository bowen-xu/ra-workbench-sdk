import { AgentSessionDecodeError, type AgentEvent } from "@research-assistant/core/agent";
import type { AgentSessionGateway } from "./session";

export interface AgentHistoryFeed {
  /** Highest sequence successfully accepted by onBatch, never just received. */
  readonly afterSeq: number;
  readonly done: Promise<number>;
  stop(): void;
}
export interface AgentHistoryFeedOptions {
  readonly conversationId: string;
  readonly afterSeq: number;
  /** Apply the batch before resolving. On failure the cursor stays unchanged. */
  readonly onBatch: (events: readonly AgentEvent[]) => void | Promise<void>;
  /** True only after the complete fixed history snapshot has been applied. */
  readonly onSyncState?: (synchronized: boolean) => void;
}
const STOPPED = Symbol("agent history subscription stopped");

/** Stop waiting locally without pretending an already-dispatched IPC was canceled.
 * Both resolution and rejection of a late request remain observed and ignored. */
function untilStopped<T>(operation: Promise<T>, signal: AbortSignal): Promise<T | typeof STOPPED> {
  return new Promise((resolve, reject) => {
    const stop = (): void => resolve(STOPPED);
    signal.addEventListener("abort", stop, { once: true });
    operation.then(
      (value) => { signal.removeEventListener("abort", stop); resolve(signal.aborted ? STOPPED : value); },
      (error: unknown) => { signal.removeEventListener("abort", stop); if (signal.aborted) resolve(STOPPED); else reject(error); },
    );
    if (signal.aborted) stop();
  });
}

/** One serial consumer per host subscription. Stores no history, runs no tools.
 * Stop on detach; a new host resumes from its own last successfully applied seq.
 * The caller must observe done failures and decide when to reconnect. */
export function startAgentHistoryFeed(
  gateway: Pick<AgentSessionGateway, "readHistory" | "waitForHistory">,
  options: AgentHistoryFeedOptions,
): AgentHistoryFeed {
  if (!Number.isSafeInteger(options.afterSeq) || options.afterSeq < 0) throw new AgentSessionDecodeError();
  const controller = new AbortController();
  const { signal } = controller;
  const conversationId = options.conversationId.toLowerCase();
  let cursor = options.afterSeq;
  const done = (async (): Promise<number> => {
    let needsHistory = true;
    while (!signal.aborted) {
      if (needsHistory) {
        options.onSyncState?.(false);
        let target: number | undefined;
        let snapshotId: string | undefined;
        do {
          const limit = target === undefined ? 100 : Math.min(100, target - cursor);
          const page = await untilStopped(gateway.readHistory({ conversationId, afterSeq: cursor, limit,
            ...(snapshotId === undefined ? {} : { snapshotId }) }), signal);
          if (page === STOPPED) return cursor;
          if (page.conversationId !== conversationId || page.afterSeq !== cursor || page.watermark < cursor
            || (target !== undefined && page.watermark < target)) throw new AgentSessionDecodeError();
          const initialPage = target === undefined;
          target ??= page.watermark;
          if ((!initialPage && page.snapshotId !== snapshotId)
            || (snapshotId !== undefined && page.watermark !== target)) throw new AgentSessionDecodeError();
          snapshotId ??= page.snapshotId;
          const targetSeq = target;
          const batch = page.events.filter(event => event.seq <= targetSeq);
          if (batch.some((event, index) => event.conversationId !== conversationId || event.seq !== cursor + index + 1)
            || (batch.length === 0 && cursor < target)) throw new AgentSessionDecodeError();
          if (batch.length > 0) {
            const acceptedSeq = batch.at(-1)!.seq;
            await options.onBatch(batch);
            cursor = acceptedSeq;
          }
          if (signal.aborted) return cursor;
        } while (cursor < target);
        options.onSyncState?.(true);
        needsHistory = false;
      }
      if (signal.aborted) break;
      // The transport must receive the signal: resolving only the local race
      // leaves the old long poll consuming a preview connection or native wait.
      const notice = await untilStopped(gateway.waitForHistory({ conversationId, afterSeq: cursor, waitMs: 30_000 }, signal), signal);
      if (notice === STOPPED) break;
      if (notice.conversationId !== conversationId || notice.afterSeq !== cursor) throw new AgentSessionDecodeError();
      if (notice.resyncRequired) { needsHistory = true; continue; }
      if (notice.events !== undefined) {
        if (notice.events.some((event, index) => event.conversationId !== conversationId || event.seq !== cursor + index + 1)
          || (notice.events.length > 0 && (notice.watermark === null || notice.events.at(-1)!.seq > notice.watermark))
          || (notice.watermark !== null && notice.events.length === 0)) throw new AgentSessionDecodeError();
        if (notice.events.length > 0) {
          const acceptedSeq = notice.events.at(-1)!.seq;
          // Finish applying before acknowledging this cursor, even after stop.
          await options.onBatch(notice.events);
          cursor = acceptedSeq;
        }
      } else if (notice.watermark !== null) {
        // Compatibility for existing mock/older gateways, not the native path.
        needsHistory = true;
      }
    }
    return cursor;
  })();
  return { get afterSeq() { return cursor; }, done, stop: () => controller.abort() };
}
