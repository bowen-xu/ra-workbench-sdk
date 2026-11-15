import { mergeText, renderMerge } from "./merge";
import { createDraft, paragraph, planSynchronization, type ModelSnapshot, type ParagraphUpdate, type SynchronizationPlan } from "./model";
import type { HbsTextPolicy } from "./textDiff";

export interface HistoryCommit { readonly before: ModelSnapshot; after: ModelSnapshot; applied: boolean }
export type HistoryDirection = "before" | "after";
export type HistoryReplayPlan = { readonly update: ParagraphUpdate } | { readonly conflict: SynchronizationPlan };

/** A compensating write merges only this command's S/B delta into the current
 * document. Revisions and unrelated remote changes are never rewound. */
export function planHistoryReplay(commits: readonly HistoryCommit[], direction: HistoryDirection, latest: ModelSnapshot, id: string, policy: HbsTextPolicy): HistoryReplayPlan {
  const diff = policy.calculate;
  let saved = paragraph(latest.saved, id).text, baseline = paragraph(latest.baseline, id).text;
  const ordered = direction === "before" ? [...commits].reverse() : commits;
  for (const commit of ordered.filter(commit => commit.applied)) {
    const source = direction === "before" ? commit.after : commit.before;
    const target = direction === "before" ? commit.before : commit.after;
    const value = paragraph(target.saved, id).text, accepted = paragraph(target.baseline, id).text;
    const savedParts = mergeText(paragraph(source.saved, id).text, value, saved, diff);
    const baselineParts = mergeText(paragraph(source.baseline, id).text, accepted, baseline, diff);
    if ([...savedParts, ...baselineParts].some(part => part.source === "conflict")) {
      return { conflict: planSynchronization(source, latest, id, {
        ...createDraft(source, id, value), editedBaseline: accepted, kind: "candidate",
      }, policy) };
    }
    saved = renderMerge(savedParts, "candidate", baseline).saved;
    baseline = renderMerge(baselineParts, "candidate", baseline).saved;
  }
  return { update: { id, saved, baseline } };
}
