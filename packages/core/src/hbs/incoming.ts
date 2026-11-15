import type { MergePart } from "./merge";
import type { SavePlan } from "./model";
import { positionMap, type HbsTextPolicy } from "./textDiff";

export interface IncomingEdit {
  readonly id: string;
  readonly ids: readonly string[];
  readonly from: number;
  readonly to: number;
  readonly text: string;
  readonly base: string;
  readonly document: string;
}
export interface IncomingChoice {
  readonly ids: readonly string[];
  readonly action: "incoming" | "both" | "keep" | "undo";
  readonly value: string;
  readonly baseline: string;
}
export function incomingPartId(id: string, part: MergePart): string { return `${id}:${part.from}:${part.to}`; }

/** Map genuine three-way conflict ranges to the displayed branch. Baseline-only
 * conflicts are projected through B′ → H instead of guessing offsets. */
export function incomingEdits(plan: SavePlan, value: string, baseline: string, current: "local" | "remote", policy: HbsTextPolicy): IncomingEdit[] {
  const mapping = (before: string, after: string) => positionMap(before, after, policy);
  const original = mapping(value, baseline);
  const ranges = plan.paragraphs.flatMap(item => {
    const source = item.parts.map(part => part[current]).join("");
    const positions = mapping(source, value);
    let offset = 0;
    return item.parts.flatMap(part => {
      const from = offset; offset += part[current].length;
      return part.source === "conflict" ? [{ id: incomingPartId(item.id, part), from: positions.mapPos(from, -1), to: positions.mapPos(offset, 1) }] : [];
    });
  }).sort((a, b) => a.from - b.from || a.to - b.to);
  const groups: { from: number; to: number; ids: string[] }[] = [];
  for (const range of ranges) {
    const prior = groups.at(-1);
    if (prior && range.from <= prior.to) { prior.to = Math.max(prior.to, range.to); prior.ids.push(range.id); }
    else groups.push({ from: range.from, to: range.to, ids: [range.id] });
  }
  const incoming = (current==="local"?plan.paragraphs[0]?.incoming:undefined) ?? plan.paragraphs[0]?.parts.map(part => part[current === "local" ? "remote" : "local"]).join("") ?? value;
  const positions = mapping(value, incoming);
  return groups.map(group => ({ ...group, id: group.ids.join("|"), document: incoming,
    text: incoming.slice(positions.mapPos(group.from, -1), positions.mapPos(group.to, 1)),
    base: baseline.slice(original.mapPos(group.from, -1), original.mapPos(group.to, 1)),
  }));
}

/** Advance the local common ancestor only at explicitly reconciled ranges.
 * Other conflicts retain their original ancestor and must still be decided. */
export function reconciledAncestor(id: string, parts: readonly MergePart[], selected: ReadonlySet<string>, incoming: "local" | "remote" = "remote"): string {
  return parts.map(part => selected.has(incomingPartId(id, part)) ? part[incoming] : part.base).join("");
}
