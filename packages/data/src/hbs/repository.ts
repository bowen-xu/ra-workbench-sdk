import { applyParagraphUpdates, type HbsRepository, type HbsSnapshot, type HbsUnitUpdate } from "@research-assistant/core/hbs";
import { decodeHbsSnapshot } from "./codec";

/** In-process repository with an optional durable database/file write callback.
 * A real multi-process adapter must implement its own transactional CAS. */
export class MemoryHbsRepository implements HbsRepository {
  private snapshot: HbsSnapshot;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(initial: HbsSnapshot, private readonly persist?: (next: HbsSnapshot) => void | Promise<void>) {
    this.snapshot = decodeHbsSnapshot(initial);
  }
  read(): HbsSnapshot { return decodeHbsSnapshot(this.snapshot); }
  commit(expectedVersion: number, updates: readonly HbsUnitUpdate[]): Promise<HbsSnapshot> {
    const operation = this.tail.then(async () => {
      if (expectedVersion !== this.snapshot.version) throw new Error("MODEL_VERSION_CONFLICT：S 已更新。");
      const next = decodeHbsSnapshot(applyParagraphUpdates(this.snapshot, updates, expectedVersion + 1));
      await this.persist?.(decodeHbsSnapshot(next));
      this.snapshot = next; return this.read();
    });
    this.tail = operation.catch(() => undefined); return operation;
  }
}
