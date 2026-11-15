/** Runtime view contracts. These do not identify attachments, notes or manuscripts. */
export interface PdfDocumentIdentity { readonly key: string; readonly revision: string }
export interface PdfSource extends PdfDocumentIdentity { readonly bytes: Uint8Array }
export interface PdfRect { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
/** Top-left origin, relative to the visible page viewport, with values in [0, 1]. */
export type PdfNormalizedRect = PdfRect;
/** PDF user-space rectangle; transform with the current PDF.js viewport before drawing. */
export type PdfUserRect = PdfRect;
export type PdfScale = { readonly kind: "numeric"; readonly value: number }
  | { readonly kind: "page-fit" | "page-width" | "page-height" | "auto" };
export interface PdfScaleLimits { readonly min: number; readonly max: number }
export interface PdfViewState {
  readonly pageIndex: number;
  readonly scale: PdfScale;
  /** Raw PDF coordinates, independent of zoom and device pixels. */
  readonly top?: number;
  readonly left?: number;
  readonly scrollMode: "vertical";
  readonly spreadMode: "none";
}
export interface PdfLocation {
  readonly alignment?: "center";
  readonly pageIndex?: number;
  readonly pageLabel?: string;
  readonly destination?: string | readonly (string | number | boolean | null | { readonly name: string })[];
  readonly position?: { readonly segments: readonly { readonly pageIndex: number; readonly rects: readonly PdfNormalizedRect[] }[] };
  readonly scale?: PdfScale;
  readonly top?: number;
  readonly left?: number;
  readonly behavior?: "instant" | "smooth";
  readonly ifNeeded?: boolean;
  readonly visibilityMargin?: number;
}
/** One-based page-local reading-order character positions; end is inclusive. */
export interface PdfSelectionTextLocation {
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  readonly endColumn: number;
}
export interface PdfSelectionSegment {
  readonly location?: PdfSelectionTextLocation;
  /** Bounded nearby source text for explicit contextual reading actions; not an anchor selector. */
  readonly context?: { readonly before: string; readonly after: string };
  readonly pageIndex: number;
  readonly rects: readonly PdfNormalizedRect[];
  readonly text: string;
  readonly prefix: string;
  readonly suffix: string;
}
export interface PdfSelection {
  readonly text: string;
  readonly segments: readonly PdfSelectionSegment[];
  readonly focusPageIndex: number;
  readonly focusRect: PdfNormalizedRect;
}
export interface PdfPagePoint {
  readonly pageIndex: number;
  /** Raw PDF user-space point (normally bottom-left origin). */
  readonly x: number;
  readonly y: number;
  readonly pageBox: readonly [number, number, number, number];
}
export interface PdfPagePointerEvent {
  readonly document: PdfDocumentIdentity;
  readonly phase: "down" | "up";
  readonly point: PdfPagePoint;
}
export function samePdfDocument(a: PdfDocumentIdentity | undefined, b: PdfDocumentIdentity | undefined): boolean {
  return a !== undefined && b !== undefined && a.key === b.key && a.revision === b.revision;
}
export function clampPdfScale(value: number, limits: PdfScaleLimits): number {
  return Number.isFinite(value) ? Math.max(limits.min, Math.min(limits.max, value)) : limits.min;
}
