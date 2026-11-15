import type { ModelSnapshot, ParagraphUpdate } from "./model";

export type MaybePromise<T> = T | Promise<T>;
/** Semantic commit. `base` is local materialization context, not necessarily
 * transmitted. A wire adapter chooses snapshot or patch encoding. */
export interface HbsCommitRequest {
  readonly id: string;
  readonly expectedVersion: number;
  readonly base: ModelSnapshot;
  readonly updates: readonly ParagraphUpdate[];
}
export interface HbsCommitReceipt { readonly requestId: string; readonly version: number }
export interface HbsClientPort {
  readonly initialSnapshot: ModelSnapshot;
  subscribeSnapshots(listener: (snapshot: ModelSnapshot) => void): () => void;
  syncLatest(knownVersion: number): Promise<ModelSnapshot | undefined>;
  commit(request: HbsCommitRequest): Promise<HbsCommitReceipt>;
  recordAction?(message: string): void;
}
export class HbsCommitError extends Error {
  constructor(message: string, readonly snapshot: ModelSnapshot) { super(message); this.name = "HbsCommitError"; }
}
/** Database/file adapters own atomic S/B CAS, durability and cross-process
 * coordination. Resolve only after durable success; never partially install B. */
export interface HbsRepository {
  read(): MaybePromise<ModelSnapshot>;
  commit(expectedVersion: number, updates: readonly ParagraphUpdate[]): MaybePromise<ModelSnapshot>;
}
