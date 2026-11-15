import type { DocumentChange, DocumentPath } from "../document";
import { align } from "./alignment";
import { changeAt, equalValue, identity, isObject } from "./value";

export interface StructurePolicy {
  atom(value: unknown): boolean;
  atomicPair?(before: unknown, after: unknown): string | undefined;
  matrix(path: DocumentPath, value: unknown): boolean;
  compatibleSequenceItems?(before: unknown, after: unknown): boolean;
}
const ambiguous = "子单元不能唯一对应，按完整父单元核对";
export function structuralDiff(before: unknown, after: unknown, policy: StructurePolicy, path: DocumentPath = [], beforePath = path): DocumentChange[] {
  if (equalValue(before, after)) return [];
  const whole = (reason?: string) => [changeAt(path, before, after, "node", reason, beforePath)];
  const pairReason = policy.atomicPair?.(before, after);
  if (pairReason) return whole(pairReason);
  if (policy.atom(before) || policy.atom(after)) return whole();
  if (Array.isArray(before) && Array.isArray(after)) {
    if (policy.matrix(path, after)) return matrixDiff(before, after, path, beforePath);
    const left = before.map(identity), right = after.map(identity);
    if ([...left, ...right].every(Boolean) && new Set(left.map(id => id!.value)).size === left.length && new Set(right.map(id => id!.value)).size === right.length) {
      const changes: DocumentChange[] = [];
      const oldOrder = left.map(id => id!.value), order = right.map(id => id!.value);
      for (const id of [...new Map([...left, ...right].map(id => [id!.value, id!])).values()]) {
        const a = before.find(value => identity(value)?.value === id.value), b = after.find(value => identity(value)?.value === id.value);
        const nested = structuralDiff(a, b, policy, [...path, id], [...beforePath, id]);
        changes.push(...nested.map(change => a === undefined || b === undefined ? { ...change, placement: {before:oldOrder,after:order} } : change));
      }
      if (!equalValue(oldOrder.filter(id => order.includes(id)), order.filter(id => oldOrder.includes(id)))) changes.push(changeAt(path, before, after, "order", undefined, beforePath));
      return changes;
    }
    const matched = align(before, after, policy.compatibleSequenceItems);
    if (matched.ambiguous) return whole(ambiguous);
    // Insertions/deletions without stable keys own the sequence. We cannot
    // preserve an index as an identity after another branch changes its shape.
    if (matched.pairs.some(pair => pair.before === undefined || pair.after === undefined)) return whole("无稳定身份的序列结构变化，按完整序列核对");
    return matched.pairs.flatMap(pair => structuralDiff(before[pair.before!], after[pair.after!], policy,
      [...path, pair.after!], [...beforePath, pair.before!]));
  }
  if (isObject(before) && isObject(after)) {
    if (before.type !== after.type || before.kind !== after.kind) return whole();
    return [...new Set([...Object.keys(before), ...Object.keys(after)])].flatMap(key =>
      structuralDiff(before[key], after[key], policy, [...path, key], [...beforePath, key]));
  }
  return [changeAt(path, before, after, typeof before === "string" && typeof after === "string" ? "text" : "property", undefined, beforePath)];
}
function rectangular(value: readonly unknown[]): value is unknown[][] {
  return value.every(Array.isArray) && value.every(row => row.length === (value[0] as unknown[] | undefined)?.length);
}
function transpose(rows: unknown[][]): unknown[][] { return (rows[0] ?? []).map((_, col) => rows.map(row => row[col])); }
function matrixDiff(before: unknown[], after: unknown[], path: DocumentPath, beforePath: DocumentPath): DocumentChange[] {
  const whole = (reason: string) => [changeAt(path, before, after, "node", reason, beforePath)];
  if (!rectangular(before) || !rectangular(after)) return whole("不规则表格按完整结构核对");
  const oldWidth = before[0]?.length ?? 0, width = after[0]?.length ?? 0;
  if (before.length !== after.length && oldWidth !== width) return whole("行列同时变化，按完整表格核对");
  const columns = oldWidth !== width;
  const left = columns ? transpose(before) : before, right = columns ? transpose(after) : after;
  const matched = align(left, right);
  if (matched.ambiguous) return whole(ambiguous);
  const changes: DocumentChange[] = [];
  for (const pair of matched.pairs) {
    if (pair.before === undefined || pair.after === undefined) {
      const beforeFrom = pair.before ?? matched.pairs.slice(0, matched.pairs.indexOf(pair)).filter(p => p.before !== undefined).length;
      const afterFrom = pair.after ?? matched.pairs.slice(0, matched.pairs.indexOf(pair)).filter(p => p.after !== undefined).length;
      const beforeCount = pair.before === undefined ? 0 : 1, afterCount = pair.after === undefined ? 0 : 1;
      const change = changeAt(path, left.slice(beforeFrom, beforeFrom + beforeCount), right.slice(afterFrom, afterFrom + afterCount), columns ? "column" : "row", undefined, beforePath);
      changes.push({ ...change, id: `${change.id}:${beforeFrom}:${afterFrom}`,
        axis: { direction: columns ? "column" : "row", beforeFrom, afterFrom, beforeCount, afterCount } });
    } else {
      for (let n = 0; n < (left[pair.before]?.length ?? 0); n++) {
        const oldCell = columns ? [n, pair.before] : [pair.before, n], cell = columns ? [n, pair.after] : [pair.after, n];
        // A cell is an independently reviewable container. Its internal text
        // merge remains recursive, but its wrapper is never split for display.
        const a = (before[oldCell[0]!] ?? [])[oldCell[1]!], b = (after[cell[0]!] ?? [])[cell[1]!];
        if (!equalValue(a, b)) changes.push(changeAt([...path, ...cell], a, b, "cell", undefined, [...beforePath, ...oldCell]));
      }
    }
  }
  if (changes.some(change => change.axis) && changes.length > 1) return whole("多个相关行列结构变更按完整表格核对，避免部分应用后坐标错位");
  return changes;
}
