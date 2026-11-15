import {
  applyAgentEvents, createAgentConversationProjection, AgentSessionDecodeError,
  type AgentConversationProjection,
} from "@research-assistant/core/agent";
import { startAgentHistoryFeed, type AgentHistoryFeed } from "./historyFeed";
import type { AgentSessionGateway } from "./session";

const OPEN_TIMEOUT_MS = 20_000;

/** Bound a native session-open wait without abandoning the late IPC promise. */
function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("agent session open timed out")), timeoutMs);
    operation.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error: unknown) => { clearTimeout(timer); reject(error); },
    );
  });
}

export interface AgentConversationSnapshot {
  readonly status: "idle" | "opening" | "syncing" | "ready" | "paused" | "error";
  readonly projection: AgentConversationProjection | null;
  /** For the host's error adapter, never render raw IPC errors as user text. */
  readonly error: unknown;
}

export type AgentConversationProjectionCache = ReadonlyMap<string, AgentConversationProjection>;

/** UI subscription owner only. Pausing/disposal never stops a native Agent turn.
 * Keep one instance per UI surface; React may subscribe with useSyncExternalStore.
 * Snapshots are read-only and listeners must not throw or mutate them. */
export class AgentConversationController {
  private snapshot: AgentConversationSnapshot = { status: "idle", projection: null, error: null };
  private readonly listeners = new Set<() => void>();
  private feed: AgentHistoryFeed | null = null;
  private generation = 0;
  private disposed = false;
  private conversationId: string | null = null;

  constructor(private readonly gateway: AgentSessionGateway, initialProjection?: AgentConversationProjection) {
    if (initialProjection !== undefined) {
      this.conversationId = initialProjection.conversationId;
      this.snapshot = { status: "paused", projection: initialProjection, error: null };
    }
  }
  readonly getSnapshot = (): AgentConversationSnapshot => this.snapshot;
  readonly subscribe = (listener: () => void): (() => void) => {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private publish(snapshot: AgentConversationSnapshot): void {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener();
  }
  private invalidate(): number {
    this.generation += 1;
    this.feed?.stop();
    this.feed = null;
    return this.generation;
  }
  private isCurrent(generation: number): boolean { return !this.disposed && this.generation === generation; }

  /** Resolves after opening and starting history catch-up, not after all history.
   * Operational failures are published as error state; stale completions are ignored. */
  async open(conversationId: string, mode: "open" | "create" = "open"): Promise<void> {
    if (this.disposed) return;
    const generation = this.invalidate();
    const identity = conversationId.toLowerCase();
    this.conversationId = identity;
    const previous = this.snapshot.projection;
    const projection = previous?.conversationId === identity ? previous : createAgentConversationProjection(identity);
    // A cached draft may have finished while this host was detached. Keep it as
    // a read checkpoint, not a provisional live response in the newly opened UI.
    const presented = this.snapshot.status !== "paused" && previous?.conversationId === identity ? previous : null;
    this.publish({ status: "opening", projection: presented, error: null });
    // A listener may synchronously switch or dispose the controller.
    if (!this.isCurrent(generation)) return;
    try {
      const session = await withTimeout(this.gateway[mode](identity), OPEN_TIMEOUT_MS);
      if (!this.isCurrent(generation)) return;
      if (session.conversationId !== identity || session.watermark < projection.seq) throw new AgentSessionDecodeError();
      this.publish({ status: "syncing",
        projection: projection.seq >= session.watermark ? projection : presented, error: null });
      if (!this.isCurrent(generation)) return;
      let pending = projection;
      let synchronized = false;
      const feed = startAgentHistoryFeed(this.gateway, {
        conversationId: identity, afterSeq: projection.seq,
        onBatch: (events) => {
          if (!this.isCurrent(generation)) return;
          pending = applyAgentEvents(pending, events);
          // Replay pages become visible only as one complete fixed snapshot.
          if (synchronized) this.publish({ status: "ready", projection: pending, error: null });
        },
        onSyncState: (ready) => {
          if (!this.isCurrent(generation)) return;
          synchronized = ready;
          if (ready) this.publish({ status: "ready", projection: pending, error: null });
          else if (this.snapshot.status !== "syncing") this.publish({ ...this.snapshot, status: "syncing", error: null });
        },
      });
      this.feed = feed;
      // This observer owns all future feed errors; no detached rejected Promise.
      void this.observe(feed, generation);
    } catch (error: unknown) {
      if (this.isCurrent(generation)) this.publish({ ...this.snapshot, status: "error", error });
    }
  }
  private async observe(feed: AgentHistoryFeed, generation: number): Promise<void> {
    try { await feed.done; }
    catch (error: unknown) {
      if (this.isCurrent(generation)) {
        this.feed = null;
        this.publish({ ...this.snapshot, status: "error", error });
      }
    }
  }
  pause(): void {
    if (this.disposed) return;
    this.invalidate();
    this.publish({ ...this.snapshot, status: this.conversationId ? "paused" : "idle", error: null });
  }
  async resume(): Promise<void> {
    const identity = this.conversationId;
    if (identity) await this.open(identity);
  }
  dispose(): void {
    this.disposed = true;
    this.invalidate();
    this.listeners.clear();
  }
}
