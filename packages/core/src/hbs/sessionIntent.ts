import type { DocumentChange, DocumentConflict, DocumentSnapshot, HbsDocumentAdapter } from "./document";
import { containsPath, equalValue } from "./structure/value";

export interface HbsHistoryPoint<D> {
  readonly content: D; readonly baseline: D; readonly ancestor: D;
  readonly reviewAncestor?: D; readonly baselineAncestor: D;
}
export interface HbsHistoryEntry<D> {
  readonly before: HbsHistoryPoint<D>; after: HbsHistoryPoint<D>;
  committedBefore: DocumentSnapshot<D>; committedAfter?: DocumentSnapshot<D>;
  replay?: "before" | "after"; reviewTarget?: HbsHistoryPoint<D>; cancelled?: readonly Intent<D>[];
}

export interface Intent<D> {
  readonly content: D; readonly baseline: D; readonly source: D; readonly sourceBaseline: D;
  readonly kind: "review" | "history"; readonly owner?: HbsHistoryEntry<D>;
  readonly direction?: "before" | "after"; readonly replay?: HbsHistoryPoint<D>;
  readonly origin?: D; readonly targetOrigin?: D;
}
interface IntentContext<D> { readonly content: D; readonly baselineProjection: D; readonly observed: DocumentSnapshot<D> }

/** The same plan owns dispatch and the displayed conflict. History changes
 * actual S/B; a staged review instead follows the current human projection. */
export function planIntent<D>(adapter: HbsDocumentAdapter<D>, intent: Intent<D>, context: IntentContext<D>) {
  return intent.kind === "history" ? {
    content: adapter.merge(intent.source, intent.content, context.observed.saved),
    baseline: adapter.merge(intent.sourceBaseline, intent.baseline, context.observed.baseline),
  } : {
    content: adapter.merge(intent.source, context.content, intent.content),
    baseline: adapter.merge(intent.sourceBaseline, context.baselineProjection, intent.baseline),
  };
}

export function intentConflicts<D>(adapter: HbsDocumentAdapter<D>, intent: Intent<D>, context: IntentContext<D>): readonly DocumentConflict[] {
  const plan = planIntent(adapter, intent, context);
  return [...plan.content.conflicts, ...plan.baseline.conflicts.map(change =>
    intent.kind === "history" ? { ...change, origin: "baseline" as const } : change)].map(change => {
    if (intent.kind !== "history") return change;
    const after = adapter.read(context.content, change.path);
    if (!change.text || typeof after !== "string" || !adapter.textIncoming) return { ...change, after };
    const range = adapter.textIncoming(change, context.content, context.baselineProjection, context.observed.saved);
    return { ...change, after, text: { ...change.text, fromB: range.from, toB: range.to } };
  });
}

/** Remove only the reviewed proposal ranges, retaining every independent
 * delta even when it merges cleanly. Both sides share the chosen range so a
 * later dispatch cannot propose an older value behind the explicit choice. */
export interface ReviewedRanges<D> {
  readonly selected: readonly DocumentChange[]; readonly point: HbsHistoryPoint<D>;
}
export function projectIntentRanges<D>(adapter: HbsDocumentAdapter<D>, value: D, choice: D, selected: readonly DocumentChange[]): D {
  return selected.reduce((current, change) => {
    const incoming = adapter.read(choice, change.path);
    if (adapter.resolveConflict && change.text) return adapter.resolveConflict({
      content: current, baseline: choice, ancestor: current, baselineAncestor: choice, confirmed: choice, saved: choice,
    }, { ...change, incoming }, "incoming").content;
    if (change.kind === "order") return adapter.apply(current, { ...change,
      before: adapter.read(current, change.path), after: incoming }, "after");
    return adapter.replace(current, change.path, incoming);
  }, value);
}
export function consumeIntentRanges<D>(adapter: HbsDocumentAdapter<D>, intent: Intent<D>, { selected, point }: ReviewedRanges<D>): Intent<D> {
  const delta = [...adapter.diff(intent.source, intent.content), ...adapter.diff(intent.sourceBaseline, intent.baseline)];
  const relevant = selected.filter(change => {
    // An atomic ancestor fallback can include unrelated, later identities.
    // A path unchanged on both actual command branches is outside its delta.
    if (equalValue(adapter.read(intent.source, change.path), adapter.read(intent.content, change.path))
      && equalValue(adapter.read(intent.sourceBaseline, change.path), adapter.read(intent.baseline, change.path))) return false;
    return delta.some(part => {
    if (!containsPath(change.path, part.path) && !containsPath(part.path, change.path)) return false;
    if (!change.text || !part.text || !adapter.textIncoming) return true;
    const a = adapter.textIncoming({ ...change, incoming: change.after }, point.content, point.baseline, point.content);
    const b = adapter.textIncoming({ ...part, incoming: part.after }, point.content, point.baseline, point.content);
    return a.from <= b.to && b.from <= a.to;
    });
  });
  if (!relevant.length) return intent;
  const replace = (value: D, choice: D): D => projectIntentRanges(adapter, value, choice, relevant);
  const origin = point.reviewAncestor === undefined ? point.ancestor : point.reviewAncestor;
  return { ...intent, source: replace(intent.source, point.content), content: replace(intent.content, point.content),
    sourceBaseline: replace(intent.sourceBaseline, point.baseline), baseline: replace(intent.baseline, point.baseline),
    ...(intent.origin === undefined ? {} : { origin: replace(intent.origin, origin) }),
    ...(intent.targetOrigin === undefined ? {} : { targetOrigin: replace(intent.targetOrigin, origin) }),
    ...(intent.replay === undefined ? {} : { replay: { ...intent.replay,
      content: replace(intent.replay.content, point.content), baseline: replace(intent.replay.baseline, point.baseline),
      ancestor: replace(intent.replay.ancestor, point.ancestor),
      reviewAncestor: replace(intent.replay.reviewAncestor === undefined ? intent.replay.ancestor : intent.replay.reviewAncestor, origin),
      baselineAncestor: replace(intent.replay.baselineAncestor, point.baselineAncestor),
    } }),
  };
}
