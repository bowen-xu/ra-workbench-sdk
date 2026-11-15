import type { DocumentChange, DocumentConflict, DocumentPath } from "../document";
import { mergeText, renderMerge, scopeReviewConflicts } from "../merge";
import { textChanges, type TextDiff } from "../textDiff";
import { changeAt } from "./value";

/** Default UTF-16 position mapping; both the ranges and the replacement text
 * come from the injected diff. Insertions honor the endpoint association. */
export function mapTextPosition(before: string, after: string, at: number, side: -1 | 1, calculate: TextDiff): number {
  let delta = 0;
  for (const change of textChanges(before, after, calculate)) {
    if (at < change.fromA) break;
    if (at === change.fromA && change.fromA < change.toA) return change.fromB;
    if (at < change.toA || at === change.toA && change.fromA === change.toA) return side < 0 ? change.fromB : change.toB;
    delta = change.toB - change.toA;
  }
  return at + delta;
}
export function textChangesAt(before: string, after: string, path: DocumentPath, calculate: TextDiff): DocumentChange[] {
  return textChanges(before, after, calculate).map(text => ({
    ...changeAt(path, before, after, "text"), text,
    id: `${changeAt(path, before, after, "text").id}:${text.fromA}:${text.toA}:${text.fromB}:${text.toB}`,
  }));
}
export function mergeTextValue(base: string, local: string, incoming: string, calculate: TextDiff, review = false) {
  const raw = mergeText(base, local, incoming, calculate);
  const parts = review ? scopeReviewConflicts(raw) : raw;
  const value = renderMerge(parts, "candidate", base, "local").saved;
  const conflicts: DocumentConflict[] = [];
  let offset = 0, remote = 0;
  for (const part of parts) {
    const shown = part.source === "remote" ? part.remote : part.local;
    if (part.source === "conflict") conflicts.push({
      ...changeAt([], base, value, "text"),
      id: `${changeAt([], base, value, "text").id}:${part.from}:${part.to}`,
      incoming, text: { fromA: part.from, toA: part.to, fromB: offset, toB: offset + shown.length },
      incomingRange: { from: remote, to: remote + part.remote.length },
    });
    offset += shown.length; remote += part.remote.length;
  }
  return { value, conflicts };
}
/** Construct only the selected replacement, retaining unrelated leaf content. */
export function selectedText(change: DocumentChange, side: "before" | "after"): { base: string; value: string } {
  const range = change.text!;
  const base = String(change[side === "after" ? "before" : "after"]);
  const target = String(change[side]);
  const from = side === "after" ? range.fromA : range.fromB, to = side === "after" ? range.toA : range.toB;
  const start = side === "after" ? range.fromB : range.fromA, end = side === "after" ? range.toB : range.toA;
  return { base, value: base.slice(0, from) + target.slice(start, end) + base.slice(to) };
}
