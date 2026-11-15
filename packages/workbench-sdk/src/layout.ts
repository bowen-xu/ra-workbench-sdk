/** Existing Core-owned selection/layout capabilities used by note management.
 * Gesture disposers release their own observers/listeners, never document owners. */
export interface RowSelectionInput {
  readonly anchorId: string | undefined;
  readonly clickedId: string;
  readonly currentIds: ReadonlySet<string>;
  readonly currentPrimaryId: string | undefined;
  readonly extendRange: boolean;
  readonly toggle: boolean;
  readonly visibleIds: readonly string[];
}
export interface RowSelectionResult {
  readonly anchorId: string;
  readonly primaryId: string | undefined;
  readonly selectedIds: ReadonlySet<string>;
}
export interface MarqueePoint { readonly clientX: number; readonly clientY: number }
export interface MarqueeCallbacks {
  readonly scrollContainer?: HTMLElement;
  readonly className?: string;
  readonly autoScroll?: boolean;
  readonly scrollVelocity?: (pointer: MarqueePoint, bounds: DOMRect) => number;
  readonly getIds: (start: MarqueePoint, end: MarqueePoint) => readonly string[];
  readonly onActivate: () => void;
  readonly onSelect: (ids: readonly string[]) => void;
  readonly onFinish: (cancelled: boolean, activated: boolean) => void;
}
export interface MarqueeHitTest {
  readonly getIds: (start: MarqueePoint, end: MarqueePoint) => readonly string[];
  readonly dispose: () => void;
}

export declare function retainRowSelectionIds(currentIds: ReadonlySet<string>, visibleIds: readonly string[]): ReadonlySet<string>;
export declare function updateRowSelection(input: RowSelectionInput): RowSelectionResult;
export declare function visibleLayoutRect(element: HTMLElement | null): DOMRect | undefined;
export declare function useVisibleLayoutMeasurement<T extends HTMLElement>(target: () => T | null, measure: (element: T, bounds: DOMRect) => void): void;
export declare function startMarqueeSelection(editor: HTMLElement, initial: PointerEvent, callbacks: MarqueeCallbacks): () => void;
export declare function createMarqueeHitTest(root: HTMLElement, pane: HTMLElement, selector: string, getId: (row: HTMLElement) => string | undefined): MarqueeHitTest;
export declare function listWindowOffsets(ids: readonly string[], sizes: ReadonlyMap<string, number>, estimate: number): number[];
export declare function listWindowBoundary(offsets: readonly number[], y: number, after: boolean): number;
export declare function listWindowRange(offsets: readonly number[], top: number, height: number): {first: number; end: number};
