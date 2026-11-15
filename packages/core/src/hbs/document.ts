/** Document values remain in their domain format. Paths describe structure,
 * never offsets in serialized JSON or rendered HTML. */
export type DocumentPath = readonly (string | number | { readonly key: string; readonly value: string })[];
export interface DocumentChange {
  readonly id: string;
  readonly path: DocumentPath;
  readonly beforePath: DocumentPath;
  readonly kind: "text" | "node" | "order" | "row" | "column" | "cell" | "property";
  readonly before: unknown;
  readonly after: unknown;
  readonly reason?: string;
  readonly axis?: { readonly direction: "row" | "column"; readonly beforeFrom: number; readonly afterFrom: number; readonly beforeCount: number; readonly afterCount: number };
  readonly placement?: { readonly before: readonly string[]; readonly after: readonly string[] };
  /** Coordinates inside the real string leaf, never serialized document JSON. */
  readonly text?: import("./textDiff").TextChange;
}
export interface DocumentConflict extends DocumentChange {
  readonly incoming: unknown;
  readonly incomingRange?: { readonly from: number; readonly to: number };
  readonly origin?: "baseline" | "review";
}
export interface DocumentMerge<D> { readonly value: D; readonly conflicts: readonly DocumentConflict[]; readonly ancestor?: D }
export interface DocumentResolution<D> { readonly content: D; readonly baseline: D; readonly ancestor: D; readonly baselineAncestor: D }
export interface HbsDocumentAdapter<D> {
  readonly kind: string;
  decode(value: unknown): D;
  equal(left: D, right: D): boolean;
  diff(before: D, after: D): readonly DocumentChange[];
  read(value: D, path: DocumentPath): unknown;
  replace(value: D, path: DocumentPath, replacement: unknown): D;
  projectManual(baseline: D, previous: D, next: D): D;
  /** Apply a planned change to a related projection. Reject ambiguous targets. */
  apply(target: D, change: DocumentChange, side: "before" | "after"): D;
  merge(base: D, local: D, incoming: D): DocumentMerge<D>;
  /** Review units retain their complete current branch at genuine conflicts.
   * Ordinary baseline transport continues to use the fine-grained merge. */
  mergeReview?(base: D, local: D, incoming: D): DocumentMerge<D>;
  /** After an ACK, retain human provenance only inside still-pending ranges.
   * An adapter may refine text within structural units; this never changes the
   * range authorized by Keep/Undo. Without it the origin stays conservative. */
  retainReviewOrigin?(origin:D,content:D,baseline:D):D;
  combine(change: DocumentConflict): unknown;
  resolveConflict?(context: DocumentResolution<D> & { readonly confirmed: D; readonly saved: D }, change: DocumentConflict,
    action: "incoming" | "both" | "keep" | "undo"): DocumentResolution<D>;
  textIncoming?(change: DocumentConflict, content: D, confirmed: D, saved: D): {
    readonly from: number; readonly to: number; readonly text: string; readonly base: string; readonly document: string;
  };
}
export interface DocumentSnapshot<D> { readonly version: number; readonly saved: D; readonly baseline: D }
export interface DocumentCommit<D> {
  readonly id: string; readonly expectedVersion: number; readonly saved: D; readonly baseline: D;
}
export interface DocumentPort<D> {
  read(): Promise<DocumentSnapshot<D>>;
  commit(request: DocumentCommit<D>): Promise<DocumentSnapshot<D>>;
}
export class DocumentVersionConflict<D> extends Error {
  constructor(readonly snapshot: DocumentSnapshot<D>, readonly requestId: string) {
    super(`MODEL_VERSION_CONFLICT：请求 ${requestId} 的起点已变化，输入已保留。`);
  }
}
export interface DocumentCheckpoint<D> {
  readonly format: 1; readonly kind: string; readonly observed: DocumentSnapshot<D>;
  readonly ancestor: D; readonly baselineAncestor: D; readonly content: D;
  /** Retains unconfirmed human candidate provenance across successful saves. */
  readonly reviewAncestor?: D;
  readonly ordinary: readonly DocumentChange[];
}
export interface DocumentPreservation<D> {
  load(): DocumentCheckpoint<D> | undefined | Promise<DocumentCheckpoint<D> | undefined>;
  save(value: DocumentCheckpoint<D>): void | Promise<void>;
}
