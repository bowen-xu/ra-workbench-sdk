/**
 * Keeps a submission coordinator scoped to its conversation rather than to a
 * mounted panel.  A panel may disappear while prepare/start is awaiting IPC;
 * the native task and its recoverable pre-admission receipt must outlive that
 * view and be observable when it is mounted again.
 */
export interface ReviewedSubmissionOwnerController {
  getSnapshot(): { readonly phase: string };
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

interface Entry<C extends ReviewedSubmissionOwnerController> {
  readonly controller: C;
  views: number;
  readonly unsubscribe: () => void;
}

export class ReviewedSubmissionOwnerRegistry<C extends ReviewedSubmissionOwnerController> {
  private readonly entries = new Map<string, Entry<C>>();

  constructor(private readonly pending: (controller: C) => boolean) {}

  hasPending(): boolean {
    for (const { controller } of this.entries.values()) {
      if (this.pending(controller)) return true;
    }
    return false;
  }

  peek(key: string): C | undefined { return this.entries.get(key)?.controller; }

  acquire(key: string, create: () => C): { readonly controller: C; readonly release: () => void } {
    const existing = this.entries.get(key);
    if (existing) {
      existing.views += 1;
      return this.lease(key, existing);
    }
    const controller = create();
    let entry!: Entry<C>;
    const unsubscribe = controller.subscribe(() => this.collect(key, entry));
    entry = { controller, views: 1, unsubscribe };
    this.entries.set(key, entry);
    return this.lease(key, entry);
  }

  private lease(key: string, entry: Entry<C>): { readonly controller: C; readonly release: () => void } {
    let released = false;
    return {
      controller: entry.controller,
      release: () => {
        if (released) return;
        released = true;
        entry.views = Math.max(0, entry.views - 1);
        this.collect(key, entry);
      },
    };
  }

  private collect(key: string, entry: Entry<C>): void {
    if (entry.views > 0 || this.pending(entry.controller) || this.entries.get(key) !== entry) return;
    this.entries.delete(key);
    entry.unsubscribe();
    entry.controller.dispose();
  }

  /** Isolates module-level owner state between UI tests. */
  resetForTests(): void {
    for (const entry of this.entries.values()) {
      entry.unsubscribe();
      entry.controller.dispose();
    }
    this.entries.clear();
  }
}
