/** The mutable working text and review baseline of one manuscript file.
 * Saving the working text does not implicitly advance the review baseline.
 * Historical Agent before/after snapshots are separate, immutable records.
 */
export interface WritingDocumentContent {
  readonly content: string;
  readonly reviewBaseline: string;
}

export interface WritingDocumentIdentity {
  readonly manuscriptId: string;
  readonly relativePath: string;
}

/** Versions cover both text and review decisions, including baseline-only Keep. */
export interface WritingDocumentSnapshot extends WritingDocumentContent, WritingDocumentIdentity {
  readonly version: number;
}
