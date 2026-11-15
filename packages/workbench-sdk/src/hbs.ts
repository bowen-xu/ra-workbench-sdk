import type {JSX, ReactNode} from "react";
import type {DocumentCommit, DocumentReviewProjector, HbsSession, TextDiff} from "@research-assistant/core/hbs";
import type {StructuredResourceKind, structuredResourceDiffFields} from "@research-assistant/core/structured-resources";

export type AppHbsDocumentKind = "note" | "structured";
/** The original bounded authority port. Public data-package decoders validate
 * its unknown replies; views do not acquire raw native dispatch or storage. */
export interface AppHbsDocumentGateway {
  read(kind: AppHbsDocumentKind, resourceId: string): Promise<unknown>;
  commit(kind: AppHbsDocumentKind, resourceId: string, request: DocumentCommit<unknown>): Promise<unknown>;
  readPreservation(kind: AppHbsDocumentKind, resourceId: string): Promise<unknown>;
  savePreservation(kind: AppHbsDocumentKind, resourceId: string, checkpoint: unknown): Promise<unknown>;
}
export interface StructuredNativeHistoryAction {readonly undo: () => boolean; readonly redo: () => boolean}
export type EditorReviewAction = "undo" | "incoming" | "both" | "keep";
export interface EditorDiffHighlightAppearance {
  readonly addedLine?: string; readonly removedLine?: string; readonly incomingLine?: string;
  readonly addedText?: string; readonly removedText?: string; readonly incomingText?: string;
  readonly incomingForeground?: string; readonly addedUnderline?: string;
  readonly addedMarker?: string; readonly removedMarker?: string; readonly incomingMarker?: string;
  readonly underlineThickness?: string;
}
export interface EditorReviewConfiguration {
  readonly highlight?: EditorDiffHighlightAppearance;
  readonly conflictActions?: readonly ("incoming" | "both")[];
  readonly labels?: Partial<Readonly<Record<EditorReviewAction, string>>>;
  readonly hints?: Partial<Readonly<Record<EditorReviewAction, string>>>;
  readonly showBulk?: boolean;
  readonly renderIncoming?: (text: string) => ReactNode;
}
export type StructuredField = ReturnType<typeof structuredResourceDiffFields>[number];
export interface HbsStructuredEditorProps {
  readonly session: HbsSession<unknown>;
  readonly configuration?: EditorReviewConfiguration;
  readonly reviewProjector?: DocumentReviewProjector;
  readonly resourceKind?: StructuredResourceKind;
  readonly title?: string;
  readonly resourceId?: string;
  readonly busy?: boolean;
  readonly submissionBlocked?: string;
  readonly renderIndicators?: (field: StructuredField) => ReactNode;
  readonly renderFooter?: (field: StructuredField) => ReactNode;
  readonly onKeepUnreviewed?: () => void;
  readonly onHistoryAction?: (action: StructuredNativeHistoryAction) => void;
  readonly onNativeHistoryReady?: (action: StructuredNativeHistoryAction) => () => void;
  readonly onHistoryCommand?: (direction: "undo" | "redo") => void;
  readonly panelOwnsHistory?: boolean;
}

/** Reuses the original production editor and its same-session native history. */
export declare function HbsStructuredEditor(props: HbsStructuredEditorProps): JSX.Element;
export declare const directTextDiff: TextDiff;
/** The singleton Core gateway retains the immutable outbox and original owner. */
export declare function getHbsDocumentGateway(): AppHbsDocumentGateway;
/** Read the original unsettled request; observation neither retries nor clears it. */
export declare function getPendingHbsDocumentCommit(kind: AppHbsDocumentKind, id: string): DocumentCommit<unknown> | undefined;
