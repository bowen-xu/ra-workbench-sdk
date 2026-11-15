/// <reference path="./daff.d.ts" />
import daff from "daff/lib/core.js";
import { isObject } from "./structure/value";

export interface TableRowPair { readonly before?: number; readonly after?: number }
export interface TableRowComparison {
  readonly pairs: readonly TableRowPair[];
  /** Present when column geometry changes; absent means fixed columns. */
  readonly columns?: readonly TableRowPair[];
  readonly ambiguous: boolean;
  readonly reason?: string;
}

/** Presentation correspondence from daff, never authorization for partial review.
 * HBS still owns review and merge semantics. */
export function compareTableRows(before: readonly (readonly unknown[])[], after: readonly (readonly unknown[])[]): TableRowComparison {
  const oldWidth = before[0]?.length ?? after[0]?.length ?? 0, newWidth = after[0]?.length ?? oldWidth;
  if (before.some(row => row.length !== oldWidth) || after.some(row => row.length !== newWidth)) {
    return fallback("列结构不规则，保留完整新旧表核对。");
  }
  if ((before.length + 1) * (after.length + 1) > 40_000 || Math.max(oldWidth, newWidth) > 256) {
    return fallback("表格超过当前比较预算，保留完整新旧表核对。");
  }
  // Daff indexes cell strings. Intern complete canonical JSON values so marks,
  // formulas and references participate without object coercion/key collisions.
  const values = new Map<string, string>();
  const encode = (rows: readonly (readonly unknown[])[]) => rows.map(row => row.map(cell => {
    const key = JSON.stringify(cell, (_key, value: unknown) => isObject(value)
      ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value) ?? "undefined";
    let token = values.get(key);
    if (token === undefined) { token = `value:${values.size}`; values.set(key, token); }
    return token;
  }));
  const oldRows = encode(before), newRows = encode(after);
  let columns: TableRowPair[] | undefined;
  if (oldWidth !== newWidth) {
    // For changed geometry use daff's column alignment, including real cell
    // values. Never infer the surviving columns from their new array indices.
    const meta = daff.compareTables(new daff.TableView(oldRows), new daff.TableView(newRows)).align().meta;
    if (!meta) return fallback("MODEL_TABLE_ALIGNMENT_INVALID：列对应不存在，保留完整新旧表核对。");
    columns = meta.toOrder().getList().map(unit => ({
      ...(unit.l >= 0 ? { before: unit.l } : {}), ...(unit.r >= 0 ? { after: unit.r } : {}),
    }));
    if (!completeCorrespondence(columns, oldWidth, newWidth)) {
      return fallback("MODEL_TABLE_ALIGNMENT_INVALID：列对应未完整覆盖表格，保留完整新旧表核对。");
    }
    if (columns.some(pair => pair.after === undefined) || reordered(columns)) {
      return fallback("删除列或列重排尚未支持内部标注，保留完整新旧表核对。");
    }
  }
  const shared = columns?.filter((pair): pair is { before: number; after: number } => pair.before !== undefined && pair.after !== undefined);
  const project = (rows: string[][], side: "before" | "after") => shared ? rows.map(row => shared.map(pair => row[pair[side]]!)) : rows;
  // Daff treats row zero as a header. Synthetic fixed-column headers keep real
  // row zero ordinary data, including headerless tables and editable headings.
  const header = Array.from({ length: shared?.length ?? oldWidth }, (_, column) => `column:${column}`);
  const alignment = daff.compareTables(new daff.TableView([header, ...project(oldRows, "before")]),
    new daff.TableView([header, ...project(newRows, "after")])).align();
  const pairs = alignment.toOrder().getList().filter(unit => unit.l !== 0 || unit.r !== 0).map(unit => ({
    ...(unit.l > 0 ? { before: unit.l - 1 } : {}), ...(unit.r > 0 ? { after: unit.r - 1 } : {}),
  }));
  if (!completeCorrespondence(pairs, before.length, after.length)) {
    return fallback("MODEL_TABLE_ALIGNMENT_INVALID：比较结果未完整覆盖表格，保留完整新旧表核对。");
  }
  if (reordered(pairs)) {
    return fallback("行顺序发生变化，当前展示按完整新旧表核对。");
  }
  return { pairs, ambiguous: false, ...(columns ? { columns } : {}) };
}

function fallback(reason: string): TableRowComparison { return { pairs: [], ambiguous: true, reason }; }

function reordered(pairs: readonly TableRowPair[]): boolean {
  const matched = pairs.flatMap(pair => pair.before !== undefined && pair.after !== undefined ? [pair.before] : []);
  return matched.some((row, index) => index > 0 && row < matched[index - 1]!);
}

function completeCorrespondence(pairs: readonly TableRowPair[], before: number, after: number): boolean {
  const seenBefore = new Set<number>(), seenAfter = new Set<number>();
  for (const pair of pairs) {
    if (pair.before === undefined && pair.after === undefined) return false;
    for (const [index, length, seen] of [[pair.before, before, seenBefore], [pair.after, after, seenAfter]] as const) {
      if (index === undefined) continue;
      if (!Number.isInteger(index) || index < 0 || index >= length || seen.has(index)) return false;
      seen.add(index);
    }
  }
  return seenBefore.size === before && seenAfter.size === after;
}
