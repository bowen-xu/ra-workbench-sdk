interface PendingController {
  subscribe(listener: () => void): () => void;
  dispose(): void;
}
interface Entry<C> {
  readonly conversationId: string;
  readonly controller: C;
  leases: number;
  unsubscribe: () => void;
}

/** App lifetime only. Controllers retain protocol state; this owner retains
 * detached unresolved operations and releases settled ones. No automatic retry. */
export class PendingOperationRegistry<C extends PendingController> {
  private readonly entries = new Map<string, Entry<C>>();
  private readonly deleted = new Set<string>();
  private roots = 0;
  private disposed = false;
  constructor(private readonly pending: (controller: C) => boolean) {}

  hasPending(matches?: (controller: C) => boolean): boolean {
    for (const { controller } of this.entries.values()) {
      if (this.pending(controller) && (!matches || matches(controller))) return true;
    }
    return false;
  }

  /** Deferred disposal permits synchronous React StrictMode effect replay. */
  retain(): () => void {
    this.roots++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.roots--;
      queueMicrotask(() => { if (this.roots === 0) this.dispose(); });
    };
  }

  acquire(key: string, conversationId: string, create: () => C): { controller: C; release: () => void } | null {
    if (this.disposed || this.deleted.has(conversationId)) return null;
    let entry = this.entries.get(key);
    if (entry && entry.conversationId !== conversationId) throw new Error("Pending operation owner scope mismatch");
    if (!entry) {
      const controller = create();
      entry = { conversationId, controller, leases: 0, unsubscribe: () => undefined };
      this.entries.set(key, entry);
      const owned = entry;
      entry.unsubscribe = controller.subscribe(() => this.collect(key, owned));
    }
    entry.leases++;
    const owned = entry;
    let released = false;
    return { controller: entry.controller, release: () => {
      if (released) return;
      released = true;
      owned.leases--;
      this.collect(key, owned);
    } };
  }

  private collect(key: string, entry: Entry<C>): void {
    if (entry.leases === 0 && !this.pending(entry.controller) && this.entries.get(key) === entry) {
      this.entries.delete(key);
      entry.unsubscribe();
      entry.controller.dispose();
    }
  }

  forgetConversation(id: string): void {
    this.deleted.add(id);
    for (const [key, entry] of this.entries) if (entry.conversationId === id) {
      this.entries.delete(key);
      entry.unsubscribe();
      entry.controller.dispose();
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const entry of this.entries.values()) { entry.unsubscribe(); entry.controller.dispose(); }
    this.entries.clear();
    this.deleted.clear();
  }
}
