export { HbsClient, type HbsClientOptions, type SyncClientState as HbsClientState } from "./client";
export { HbsCommitError, type HbsClientPort, type HbsCommitRequest, type HbsCommitReceipt, type HbsRepository, type MaybePromise } from "./ports";
export { type ModelSnapshot as HbsSnapshot, type Paragraph as HbsUnit, type ParagraphUpdate as HbsUnitUpdate, type ModelDraft as HbsDraft,
  paragraph, createDraft, planSave, finishPlan, planSynchronization, finishSynchronization, conflictingParagraphs, reviewUpdates } from "./model";
export { type HbsTextPolicy, type TextDiff, type TextChange, type TextPositionMap, textChanges } from "./textDiff";
export { mergeText, renderMerge, type MergePart, type ConflictChoice } from "./merge";
export { createTextPatch, applyTextPatch, applyParagraphUpdates, changedUpdates, type TextPatch, type ParagraphPatch } from "./patch";
export { type IncomingEdit, type IncomingChoice } from "./incoming";
export { type HbsPreservation, type HbsPreservationStore, MemoryHbsPreservationStore, capturePreservation, restorePreservation } from "./preservation";
export * from "./document";
export { HbsSession, type HbsSessionOptions, type HbsSessionState, type HbsHistoryEntry, type HbsHistoryPoint } from "./session";
export { createTextDocumentAdapter, createNoteDocumentAdapter, createStructuredDocumentAdapter } from "./adapters";
export { mapTextPosition } from "./structure/text";
export { createStructuralAdapter } from "./structure/adapter";
export type { StructurePolicy } from "./structure/diff";
export { compareTableRows, type TableRowComparison, type TableRowPair } from "./tableComparison";
export { projectDocumentReview } from "./reviewProjection";
export type { DocumentReviewFragment, DocumentReviewProjection, DocumentReviewProjectionOptions, DocumentReviewProjector } from "./reviewProjection";
