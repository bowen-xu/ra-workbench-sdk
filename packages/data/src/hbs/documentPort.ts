import { DocumentVersionConflict, type DocumentCommit, type DocumentPort, type DocumentSnapshot, type HbsDocumentAdapter } from "@research-assistant/core/hbs";

export type HbsDocumentCall = (operation: "read" | "commit", request?: unknown) => Promise<unknown>;
export function decodeDocumentSnapshot<D>(value: unknown, adapter: HbsDocumentAdapter<D>): DocumentSnapshot<D> {
  if (!value || typeof value !== "object") throw new Error("MODEL_PROTOCOL_ERROR：缺少文档快照。");
  const raw = value as Record<string, unknown>;
  if (!Number.isSafeInteger(raw.version) || (raw.version as number) < 0) throw new Error("MODEL_PROTOCOL_ERROR：无效的修订号。");
  return { version: raw.version as number, saved: adapter.decode(raw.saved), baseline: adapter.decode(raw.baseline) };
}
/** Snapshot encoding is an independent port. Text patch encoding remains
 * available through createHbsClientPort; structured adapters need no wire logic. */
export function createDocumentPort<D>(adapter: HbsDocumentAdapter<D>, call: HbsDocumentCall): DocumentPort<D> {
  return {
    read: async () => decodeDocumentSnapshot(await call("read"), adapter),
    commit: async (request: DocumentCommit<D>) => {
      const raw = await call("commit", request) as { type?: unknown; requestId?: unknown; snapshot?: unknown };
      if (raw.requestId !== request.id || !["receipt", "conflict"].includes(String(raw.type))) throw new Error(`MODEL_PROTOCOL_ERROR：请求 ${request.id} 的回执身份无效。`);
      const snapshot = decodeDocumentSnapshot(raw.snapshot, adapter);
      if (raw.type === "conflict") throw new DocumentVersionConflict(snapshot, request.id);
      return snapshot;
    },
  };
}
