import type { DocumentCheckpoint, DocumentPreservation, HbsDocumentAdapter } from "@research-assistant/core/hbs";
import { decodeDocumentSnapshot } from "./documentPort";

export function decodeDocumentCheckpoint<D>(input: unknown, adapter: HbsDocumentAdapter<D>): DocumentCheckpoint<D> {
  if (!input || typeof input !== "object") throw new Error("MODEL_RECOVERY_INVALID：缺少恢复数据。");
  const value = input as DocumentCheckpoint<unknown>;
  if (value.format !== 1 || value.kind !== adapter.kind || !Array.isArray(value.ordinary)) throw new Error("MODEL_RECOVERY_INVALID：恢复类型不匹配。");
  const {reviewAncestor,...checkpoint}=value;
  const result = {
    ...checkpoint,
    observed: decodeDocumentSnapshot(value.observed, adapter),
    content: adapter.decode(value.content),
    ancestor: adapter.decode(value.ancestor),
    ...(reviewAncestor===undefined?{}:{reviewAncestor:adapter.decode(reviewAncestor)}),
    baselineAncestor: adapter.decode(value.baselineAncestor),
  };
  let baseline = result.baselineAncestor;
  for (const change of result.ordinary) {
    if (!change || typeof change.id !== "string" || !Array.isArray(change.path) || !Array.isArray(change.beforePath)) {
      throw new Error("MODEL_RECOVERY_INVALID：恢复范围无效。");
    }
    baseline = adapter.apply(baseline, change, "after");
  }
  adapter.decode(baseline);
  return result;
}
export type HbsPreservationCall = (operation: "readPreservation" | "savePreservation", request?: unknown) => Promise<unknown>;
/** Durable preservation is independent of the authoritative S/B version guard. */
export function createDocumentPreservationPort<D>(adapter: HbsDocumentAdapter<D>, call: HbsPreservationCall): DocumentPreservation<D> {
  return {
    load: async () => {
      const value = await call("readPreservation");
      return value === null ? undefined : decodeDocumentCheckpoint(value, adapter);
    },
    save: async value => {
      const result = await call("savePreservation", decodeDocumentCheckpoint(value, adapter)) as { revision?: unknown };
      if (!Number.isSafeInteger(result?.revision) || (result.revision as number) < 1) {
        throw new Error("MODEL_PRESERVATION_PROTOCOL：保全回执无效。");
      }
    },
  };
}
