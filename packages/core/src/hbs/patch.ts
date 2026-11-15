import { textChanges, type TextDiff } from "./textDiff";
import { paragraph, type ModelSnapshot, type ParagraphUpdate } from "./model";

export interface TextPatch { readonly from: number; readonly to: number; readonly insert: string }
export interface ParagraphPatch { readonly id: string; readonly saved?: readonly TextPatch[]; readonly baseline?: readonly TextPatch[] }
export function createTextPatch(before: string, after: string, calculate: TextDiff): readonly TextPatch[] {
  return textChanges(before, after, calculate).map(change => ({ from: change.fromA, to: change.toA, insert: after.slice(change.fromB, change.toB) }));
}
/** Exact replacement, not a fuzzy patch; no editor or line-ending normalization. */
export function applyTextPatch(before: string, patches: readonly TextPatch[]): string {
  let cursor = 0, previousFrom = -1, result = "";
  for (const patch of patches) {
    if (!Number.isSafeInteger(patch.from) || !Number.isSafeInteger(patch.to) || patch.from < cursor || patch.from < 0 ||
      patch.to < patch.from || patch.to > before.length || patch.from === previousFrom || typeof patch.insert !== "string" ||
      patch.from === patch.to && !patch.insert.length) throw new Error("MODEL_INVALID_PATCH：Patch 范围、顺序或内容无效。");
    result += before.slice(cursor, patch.from) + patch.insert; cursor = patch.to; previousFrom = patch.from;
  }
  return result + before.slice(cursor);
}
export function changedUpdates(base: ModelSnapshot, updates: readonly ParagraphUpdate[]): readonly ParagraphUpdate[] {
  return updates.filter(update => paragraph(base.saved, update.id).text !== update.saved || paragraph(base.baseline, update.id).text !== update.baseline);
}
export function applyParagraphUpdates(base: ModelSnapshot, updates: readonly ParagraphUpdate[], version: number): ModelSnapshot {
  if (!Number.isSafeInteger(version) || version !== base.version + 1) throw new Error("MODEL_INVALID_PATCH：提交必须推进一个修订号。");
  const ids = new Set<string>();
  for (const update of updates) {
    paragraph(base.saved, update.id); paragraph(base.baseline, update.id);
    if (ids.has(update.id)) throw new Error("MODEL_INVALID_PATCH：重复目标。"); ids.add(update.id);
  }
  return { version, saved: base.saved.map(item => ({ ...item, text: updates.find(update => update.id === item.id)?.saved ?? item.text })),
    baseline: base.baseline.map(item => ({ ...item, text: updates.find(update => update.id === item.id)?.baseline ?? item.text })) };
}
