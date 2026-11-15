import { restorePreservation, type HbsPreservation, type TextPatch } from "@research-assistant/core/hbs";
import { decodeHbsSnapshot } from "./codec";

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("MODEL_RECOVERY_INVALID：恢复记录结构无效。");
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== "string" || value.length > 12_000) throw new Error("MODEL_RECOVERY_INVALID：恢复文本无效。");
  return value;
}
/** Validate persisted unknown data before it becomes a client state. File,
 * database and browser adapters may share this decoder without sharing I/O. */
export function decodeHbsPreservation(value: unknown, unitId: string): HbsPreservation {
  const item = record(value), input = record(item.input);
  if (input.kind !== "body" && input.kind !== "candidate" || !Array.isArray(item.ordinary) || item.ordinary.length > 12_000) {
    throw new Error("MODEL_RECOVERY_INVALID：恢复来源或范围无效。");
  }
  const ordinary: TextPatch[] = item.ordinary.map(value => {
    const change = record(value);
    if (typeof change.from !== "number" || typeof change.to !== "number") throw new Error("MODEL_RECOVERY_INVALID：恢复坐标无效。");
    return { from: change.from, to: change.to, insert: text(change.insert) };
  });
  const result: HbsPreservation = { content: text(item.content), observed: decodeHbsSnapshot(item.observed),
    input: { kind: input.kind, base: text(input.base), ...(input.syncBase===undefined?{}:{syncBase:text(input.syncBase)}),baseline: text(input.baseline) }, ordinary };
  restorePreservation(result, unitId); return result;
}
