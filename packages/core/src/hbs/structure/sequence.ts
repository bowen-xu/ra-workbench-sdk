import type { DocumentConflict } from "../document";
import { align, type Alignment } from "./alignment";
import { cloneValue, equalValue } from "./value";

interface SequenceSide { readonly positions: ReadonlyMap<number, number>; readonly insertions: ReadonlyMap<number, readonly unknown[]> }
function side(value: readonly unknown[], alignment: Alignment): SequenceSide {
  const positions = new Map<number, number>(), insertions = new Map<number, unknown[]>();
  let gap = 0;
  for (const pair of alignment.pairs) {
    if (pair.before !== undefined) {
      gap = pair.before + 1;
      if (pair.after !== undefined) positions.set(pair.before, pair.after);
    } else if (pair.after !== undefined) {
      const items = insertions.get(gap) ?? []; items.push(value[pair.after]); insertions.set(gap, items);
    }
  }
  return { positions, insertions };
}

/** Rebase two uniquely matched sequences through their common ancestor.
 * No array index is an identity. Ambiguity, competing insertions, and deleting
 * an edited unit fall back to the owner's complete structural conflict. */
export function mergeCompatibleSequence(base: readonly unknown[], local: readonly unknown[], incoming: readonly unknown[],
  merge: (base: unknown, local: unknown, incoming: unknown) => { value: unknown; conflicts: readonly DocumentConflict[] },
  compatible?: (a: unknown, b: unknown) => boolean): { value: unknown[]; conflicts: [] } | undefined {
  const left = align(base,local,compatible), right = align(base,incoming,compatible);
  if (left.ambiguous || right.ambiguous) return;
  const a = side(local,left), b = side(incoming,right), value: unknown[] = [];
  for (let index = 0; index <= base.length; index++) {
    const insertedA = a.insertions.get(index) ?? [], insertedB = b.insertions.get(index) ?? [];
    if (insertedA.length && insertedB.length && !equalValue(insertedA,insertedB)) return;
    value.push(...cloneValue(insertedA.length ? insertedA : insertedB));
    if (index === base.length) break;
    const localIndex = a.positions.get(index), incomingIndex = b.positions.get(index);
    if (localIndex === undefined && incomingIndex === undefined) continue;
    if (localIndex === undefined || incomingIndex === undefined) {
      const remaining = localIndex === undefined ? incoming[incomingIndex!] : local[localIndex];
      if (!equalValue(base[index],remaining)) return;
      continue;
    }
    const merged = merge(base[index],local[localIndex],incoming[incomingIndex]);
    if (merged.conflicts.length) return;
    value.push(merged.value);
  }
  return { value, conflicts: [] };
}
