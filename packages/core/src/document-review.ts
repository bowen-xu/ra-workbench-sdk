/** Editor-independent review policy. Editors inject their own ranges, diff
 * calculation and lossless replacement; history stays in the native editor. */
export type ReviewAction = "keep" | "undo";
export type ReviewOrigin = "agent" | "review" | "manual" | "restore" | "undo" | "redo";
export interface ReviewDocument<T> {
  readonly content: T;
  readonly reviewBaseline: T;
}
export interface ReviewRange<R> { readonly baseline: R; readonly current: R }
export interface ReviewDocumentAdapter<T, R> {
  equal(a: T, b: T): boolean;
  replace(target: T, targetRange: R, source: T, sourceRange: R): T;
}

/** Saving never resolves review. Keep changes B; Undo changes D. A whole-page
 * decision and a ranged decision follow the same rule and one history event. */
export function resolveReviewDocument<T, R>(snapshot: ReviewDocument<T>, action: ReviewAction,
  adapter: ReviewDocumentAdapter<T, R>, range?: ReviewRange<R>): ReviewDocument<T> {
  const keeping = action === "keep";
  const source = keeping ? snapshot.content : snapshot.reviewBaseline;
  const target = keeping ? snapshot.reviewBaseline : snapshot.content;
  const result = range ? adapter.replace(target, keeping ? range.baseline : range.current,
    source, keeping ? range.current : range.baseline) : source;
  if (adapter.equal(target, result)) return snapshot;
  return keeping ? { content: snapshot.content, reviewBaseline: result }
    : { content: result, reviewBaseline: snapshot.reviewBaseline };
}

export function sameReviewDocument<T>(before: ReviewDocument<T>, after: ReviewDocument<T>, equal: (a: T, b: T) => boolean): boolean {
  return equal(before.content, after.content) && equal(before.reviewBaseline, after.reviewBaseline);
}

/** History must replay the recorded B transition, never derive a new B from
 * the replay's D. Ordinary edits delegate range/identity mapping to the editor. */
export function shouldSynchronizeReviewBaseline(origin: ReviewOrigin, changed: boolean, hasBaselineChange: boolean): boolean {
  return origin === "manual" && changed && !hasBaselineChange;
}

/** Drain snapshots rather than saving a stale UI projection. The host retains
 * the exact write identity before dispatch, including uncertain acknowledgments.
 * It also owns serialization, permissions, CAS and scheduling. Used by both
 * text and block hosts; a pending Diff is deliberately not a save predicate. */
export async function persistReviewSnapshots<S, W>(port: {
  capture(): S;
  prepare(snapshot: S): W | null | Promise<W | null>;
  write(write: W): Promise<void>;
}): Promise<void> {
  for (;;) {
    const write = await port.prepare(port.capture());
    if (write === null) return;
    await port.write(write);
  }
}
