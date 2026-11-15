import {expect, it, vi} from "vitest";
import {PendingOperationRegistry} from "./pendingOperationRegistry";

function controller(kind: string) {
  const listeners = new Set<() => void>();
  return {
    kind,
    pending: false,
    subscribe: vi.fn((listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    }),
    dispose: vi.fn(),
  };
}

it("queries the original pending predicate with an optional controller filter", () => {
  const predicate = vi.fn((value: ReturnType<typeof controller>) => value.pending);
  const registry = new PendingOperationRegistry(predicate);
  expect(registry.hasPending()).toBe(false);
  const writing = controller("manuscript"), note = controller("note");
  const createWriting = vi.fn(() => writing), createNote = vi.fn(() => note);
  const first = registry.acquire("opaque writing key", "writing", createWriting)!;
  const second = registry.acquire("opaque note key", "note", createNote)!;
  note.pending = true;
  const matches = vi.fn((value: ReturnType<typeof controller>) => value.kind === "manuscript");
  expect(registry.hasPending()).toBe(true);
  expect(registry.hasPending(matches)).toBe(false);
  expect(matches).toHaveBeenCalledExactlyOnceWith(note);
  writing.pending = true;
  expect(registry.hasPending(matches)).toBe(true);
  expect(createWriting).toHaveBeenCalledOnce();
  expect(createNote).toHaveBeenCalledOnce();
  expect(writing.subscribe).toHaveBeenCalledOnce();
  expect(note.subscribe).toHaveBeenCalledOnce();
  expect(writing.dispose).not.toHaveBeenCalled();
  expect(note.dispose).not.toHaveBeenCalled();
  first.release(); second.release(); registry.dispose();
  expect(registry.hasPending()).toBe(false);
});

it("observes detached pending owners without collecting, releasing or recreating them", () => {
  const registry = new PendingOperationRegistry((value: ReturnType<typeof controller>) => value.pending);
  const value = controller("manuscript");
  value.pending = true;
  const create = vi.fn(() => value);
  const lease = registry.acquire("not JSON", "conversation", create)!;
  lease.release();
  expect(registry.hasPending()).toBe(true);
  value.pending = false;
  expect(registry.hasPending()).toBe(false);
  expect(value.dispose).not.toHaveBeenCalled();
  const reattached = registry.acquire("not JSON", "conversation", create)!;
  expect(reattached.controller).toBe(value);
  expect(create).toHaveBeenCalledOnce();
  reattached.release();
  expect(value.dispose).toHaveBeenCalledOnce();
  expect(registry.hasPending()).toBe(false);
  registry.dispose();
});
