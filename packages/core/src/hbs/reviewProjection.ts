import type { DocumentChange, DocumentPath } from "./document";
import { equalValue, identity } from "./structure/value";

type MemberIdentity = { readonly key: string; readonly value: string };

/** A read-only view of a decision. Paths identify real domain nodes; absent
 * sides have no path. These fragments never authorize a smaller Keep/Undo. */
export interface DocumentReviewFragment {
  readonly beforePath?: DocumentPath;
  readonly path?: DocumentPath;
  readonly before: unknown;
  readonly after: unknown;
  readonly placement?: { readonly before: readonly string[]; readonly after: readonly string[] };
  /** True for a surviving member outside the stable subsequence. Insertions
   * and deletions instead have an absent side and contentChanged=true. */
  readonly positionChanged: boolean;
  readonly contentChanged: boolean;
}
export interface DocumentReviewProjection {
  readonly decisionId: string;
  readonly fragments: readonly DocumentReviewFragment[];
  readonly fallbackReason?: string;
}
export interface DocumentReviewProjectionOptions {
  readonly identity?: (value: unknown) => MemberIdentity | undefined;
  readonly equal?: (before: unknown, after: unknown) => boolean;
}
/** Hosts may inject another pure projection without replacing the decision,
 * synchronization adapter, editor, persistence, or history owner. */
export type DocumentReviewProjector = (change: DocumentChange) => DocumentReviewProjection;

interface Member { readonly identity: MemberIdentity; readonly value: unknown }
function members(values: readonly unknown[], identify: NonNullable<DocumentReviewProjectionOptions["identity"]>): Map<string, Member> | undefined {
  const result = new Map<string, Member>(), valuesSeen = new Set<string>();
  for (const value of values) {
    const id = identify(value);
    // Placement uses the domain's existing identity values. A repeated value
    // cannot safely anchor a fragment, even if identity key names differ.
    if (!id || valuesSeen.has(id.value)) return;
    valuesSeen.add(id.value);
    result.set(JSON.stringify([id.key, id.value]), { identity: id, value });
  }
  return result;
}

/** A deterministic LIS over known identities, not a claim about which drag
 * gesture occurred. It keeps unaffected shifted members neutral in O(n log n). */
function stableMembers(before: readonly string[], after: readonly string[]): ReadonlySet<string> {
  const positions = new Map(before.map((key, index) => [key, index]));
  const common = after.filter(key => positions.has(key));
  const tails: number[] = [], predecessors: number[] = [];
  for (let index = 0; index < common.length; index++) {
    const position = positions.get(common[index]!)!;
    let low = 0, high = tails.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (positions.get(common[tails[middle]!]!)! < position) low = middle + 1;
      else high = middle;
    }
    predecessors[index] = low ? tails[low - 1]! : -1;
    tails[low] = index;
  }
  const result = new Set<string>();
  for (let index = tails.at(-1) ?? -1; index >= 0; index = predecessors[index]!) result.add(common[index]!);
  return result;
}

/** Separate display geometry from the original review authorization. A keyed
 * collection uses identity/sequence correspondence. Missing or duplicate
 * identities preserve the whole original range with an explicit reason.
 *
 * An order decision only owns placement: both displayed sides use the current
 * member value. Content and membership changes retain their own decisions. */
export function projectDocumentReview(change: DocumentChange, options: DocumentReviewProjectionOptions = {}): DocumentReviewProjection {
  const equal = options.equal ?? equalValue;
  const whole = (reason?: string): DocumentReviewProjection => ({
    decisionId: change.id,
    fragments: [{
      ...(change.before === undefined ? {} : { beforePath: change.beforePath }),
      ...(change.after === undefined ? {} : { path: change.path }),
      before: change.before, after: change.after,
      ...(change.placement ? { placement: change.placement } : {}),
      positionChanged: false, contentChanged: !equal(change.before, change.after),
    }],
    ...(reason || change.reason ? { fallbackReason: [change.reason, reason].filter(Boolean).join("；") } : {}),
  });
  if (!Array.isArray(change.before) && !Array.isArray(change.after)) return whole();
  if (!Array.isArray(change.before) || !Array.isArray(change.after)) return whole("集合两侧结构不同，按完整授权单元展示");
  const identify = options.identity ?? identity;
  const before = members(change.before, identify), after = members(change.after, identify);
  if (!before || !after) return whole("子单元缺少唯一稳定身份，按完整授权单元展示");
  const stable = stableMembers([...before.keys()], [...after.keys()]);
  const placement = { before: [...before.values()].map(member => member.identity.value), after: [...after.values()].map(member => member.identity.value) };
  const fragments: DocumentReviewFragment[] = [];
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const previous = before.get(key), current = after.get(key);
    if (change.kind === "order" && (!previous || !current)) continue;
    const positionChanged = !!previous && !!current && !stable.has(key);
    const contentChanged = change.kind !== "order" && (!previous || !current || !equal(previous.value, current.value));
    if (!positionChanged && !contentChanged) continue;
    fragments.push({
      ...(previous ? { beforePath: [...change.beforePath, previous.identity] } : {}),
      ...(current ? { path: [...change.path, current.identity] } : {}),
      before: change.kind === "order" ? current?.value : previous?.value,
      after: current?.value, placement, positionChanged, contentChanged,
    });
  }
  return { decisionId: change.id, fragments, ...(change.reason ? { fallbackReason: change.reason } : {}) };
}
