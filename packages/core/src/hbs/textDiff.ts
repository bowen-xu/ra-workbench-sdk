/** Diff units may conservatively span whole lines/blocks. Coordinates are
 * ordered UTF-16 ranges and must reconstruct the target exactly. */
export interface TextChange { readonly fromA: number; readonly toA: number; readonly fromB: number; readonly toB: number }
export type TextDiff = (before: string, after: string) => readonly TextChange[];
export interface TextPositionMap { mapPos(position: number, association: -1 | 1): number }
export interface HbsTextPolicy {
  readonly calculate: TextDiff;
  /** Editor/transform adapters own position mapping, not the HBS state machine. */
  readonly map: (before: string, after: string, changes: readonly TextChange[]) => TextPositionMap;
}
export function textChanges(before: string, after: string, calculate: TextDiff, maxLength = 12_000): readonly TextChange[] {
  if (before.length > maxLength || after.length > maxLength) throw new Error("MODEL_SIZE_LIMIT：文本超过当前策略限制。");
  const changes = calculate(before, after);
  const invalid = (): never => { throw new Error("MODEL_INVALID_DIFF：比较范围不能准确重建文本，输入已保留。"); };
  if (!Array.isArray(changes)) invalid();
  let endA = 0, endB = 0;
  for (const change of changes) {
    if (!change || ![change.fromA, change.toA, change.fromB, change.toB].every(Number.isSafeInteger) ||
      change.fromA < endA || change.fromB < endB || change.toA < change.fromA || change.toB < change.fromB ||
      change.toA > before.length || change.toB > after.length || change.fromA === change.toA && change.fromB === change.toB ||
      before.slice(endA, change.fromA) !== after.slice(endB, change.fromB)) invalid();
    endA = change.toA; endB = change.toB;
  }
  if (before.slice(endA) !== after.slice(endB)) invalid();
  return changes;
}
export function positionMap(before: string, after: string, policy: HbsTextPolicy): TextPositionMap {
  const mapping = policy.map(before, after, textChanges(before, after, policy.calculate));
  return { mapPos: (position, association) => {
    const result = mapping.mapPos(position, association);
    if (!Number.isSafeInteger(position) || position < 0 || position > before.length ||
      !Number.isSafeInteger(result) || result < 0 || result > after.length) throw new Error("MODEL_INVALID_MAPPING：位置映射无效，输入已保留。");
    return result;
  } };
}
