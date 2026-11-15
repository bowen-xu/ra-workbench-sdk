/** Geometry stays independent of the Core PDF.js renderer and worker. */
export interface PdfSelectionPopoverRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}
export interface PdfSelectionPopoverPosition {
  readonly left: number;
  readonly top: number;
  readonly placement: "above" | "below" | "center";
}
export declare function positionPdfSelectionPopover(input: {
  readonly anchor: PdfSelectionPopoverRect;
  readonly boundary: PdfSelectionPopoverRect;
  readonly popup: {readonly width: number; readonly height: number};
  readonly gap?: number;
  readonly padding?: number;
  readonly centerOnAnchor?: boolean;
  readonly anchorControlCenter?: number;
}): PdfSelectionPopoverPosition;

export declare function clampPdfPageIndex(pageIndex: number, pageCount: number): number;
export declare function parsePdfPageInput(input: string, pageCount: number, pageLabels?: readonly string[]): number | undefined;
