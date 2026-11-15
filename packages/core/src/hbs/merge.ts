import { textChanges, type TextDiff } from "./textDiff";
export { textChanges } from "./textDiff";

export type MergeSource = "base" | "local" | "remote" | "equal" | "conflict";
export interface MergePart {
  readonly from: number;
  readonly to: number;
  readonly base: string;
  readonly local: string;
  readonly remote: string;
  readonly source: MergeSource;
}
export type ConflictChoice = "remote" | "local" | "both" | "discard";
interface Edit { readonly from: number; readonly to: number; readonly text: string; readonly side: "local" | "remote" }

function overlaps(a: Edit, b: Edit): boolean {
  if (a.from === a.to) return a.from >= b.from && a.from <= b.to;
  if (b.from === b.to) return b.from >= a.from && b.from <= a.to;
  return a.from < b.to && b.from < a.to;
}

function branch(base: string, from: number, to: number, edits: readonly Edit[]): string {
  let result = "", cursor = from;
  for (const edit of edits) { result += base.slice(cursor, edit.from) + edit.text; cursor = edit.to; }
  return result + base.slice(cursor, to);
}

/** Three-way merge over a shared ancestor. Connected overlapping edit ranges
 * are compared as a group; identical results converge, incompatible ones remain. */
export function mergeText(base: string, local: string, remote: string, calculate: TextDiff): readonly MergePart[] {
  const edits = (["local", "remote"] as const).flatMap(side => {
    const target = side === "local" ? local : remote;
    return textChanges(base, target, calculate).map(change => ({ from: change.fromA, to: change.toA,
      text: target.slice(change.fromB, change.toB), side }));
  }).sort((a, b) => a.from - b.from || a.to - b.to);
  const groups: Edit[][] = [];
  for (const edit of edits) {
    const last = groups.at(-1);
    if (last?.some(prior => overlaps(prior, edit))) last.push(edit);
    else groups.push([edit]);
  }
  const parts: MergePart[] = [];
  let cursor = 0;
  const unchanged = (to: number) => {
    if (to > cursor) { const text = base.slice(cursor, to); parts.push({ from: cursor, to, base: text, local: text, remote: text, source: "base" }); }
  };
  for (const group of groups) {
    const from = Math.min(...group.map(edit => edit.from)), to = Math.max(...group.map(edit => edit.to));
    unchanged(from);
    const left = group.filter(edit => edit.side === "local"), right = group.filter(edit => edit.side === "remote");
    const localText = branch(base, from, to, left), remoteText = branch(base, from, to, right);
    const source: MergeSource = !left.length ? "remote" : !right.length ? "local" : localText === remoteText ? "equal" : "conflict";
    parts.push({ from, to, base: base.slice(from, to), local: localText, remote: remoteText, source });
    cursor = to;
  }
  unchanged(base.length);
  return parts;
}

export function chosenText(part: MergePart, choice?: ConflictChoice): string {
  if (part.source === "conflict") {
    if (!choice || choice === "discard") throw new Error("MODEL_UNRESOLVED：请先选择冲突策略。");
    if (choice === "both") return [part.remote, part.local].filter(Boolean).join("\n");
    return part[choice];
  }
  return part.source === "remote" ? part.remote : part.local;
}

/** Ordinary manual edits advance B; remote-only edits remain pending.
 * Candidate edits never advance B, including an explicit conflict selection. */
export function renderMerge(parts: readonly MergePart[], kind: "body" | "candidate", baseline: string, choice?: ConflictChoice) {
  if (choice === "discard") return { saved: baseline, baseline };
  if (choice === "both") {
    const remote = parts.map(part => chosenText(part, "remote")).join("");
    const local = parts.map(part => chosenText(part, "local")).join("");
    const saved = remote === local ? remote : [remote, local].filter(Boolean).join("\n");
    return { saved, baseline: kind === "candidate" ? baseline : saved };
  }
  const saved = parts.map(part => chosenText(part, choice)).join("");
  const nextBaseline = kind === "candidate" ? baseline : parts.map(part =>
    part.source === "remote" ? part.base : chosenText(part, choice)).join("");
  return { saved, baseline: nextBaseline };
}

/** Review actions own whole displayed text lines. If a line has a genuine
 * overlap, retain its complete local branch until a decision; clean remote
 * fragments on that same line must not be silently spliced into current.
 * Shared unchanged newlines bound units; a changed newline stays indivisible. */
export function scopeReviewConflicts(parts: readonly MergePart[]): readonly MergePart[] {
  if (!parts.some(part => part.source === "conflict")) return parts;
  const result: MergePart[] = [], unit: MergePart[] = [];
  const flush = () => {
    if (unit.some(part => part.source === "conflict")) {
      const base = unit.map(part => part.base).join(""), local = unit.map(part => part.local).join(""), remote = unit.map(part => part.remote).join("");
      result.push({ from: unit[0]!.from, to: unit.at(-1)!.to, base, local, remote, source: local === remote ? "equal" : "conflict" });
    } else result.push(...unit);
    unit.length = 0;
  };
  for (const part of parts) {
    if (part.source !== "base") { unit.push(part); continue; }
    let start = 0;
    for (let end = part.base.indexOf("\n"); end >= 0; end = part.base.indexOf("\n", start)) {
      if (end > start) { const text = part.base.slice(start, end); unit.push({ from: part.from + start, to: part.from + end, base: text, local: text, remote: text, source: "base" }); }
      flush();
      result.push({ from: part.from + end, to: part.from + end + 1, base: "\n", local: "\n", remote: "\n", source: "base" });
      start = end + 1;
    }
    if (start < part.base.length) { const text = part.base.slice(start); unit.push({ ...part, from: part.from + start, base: text, local: text, remote: text }); }
  }
  flush(); return result;
}
