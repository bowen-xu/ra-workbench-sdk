import type {
  PdfDocumentIdentity, PdfLocation, PdfPagePoint, PdfPagePointerEvent, PdfRect,
  PdfScale, PdfScaleLimits, PdfSelection, PdfSelectionTextLocation, PdfSource, PdfViewState,
} from "@research-assistant/core/pdf-view";
import type {SourceLineRange} from "@research-assistant/core/source";
import type {JSX, PointerEventHandler, ReactNode, RefObject} from "react";

export declare function PdfViewControls(props: {
  controller: Pick<PdfViewController, "find" | "closeFind" | "focus" | "navigate" | "changeScale" | "setScale">;
  state: PdfViewSnapshot;
  scopeRef: RefObject<HTMLElement | null>;
  onShowPdf: () => void;
}): JSX.Element;

export interface PdfPageHost {
  readonly pageIndex: number;
  readonly element: HTMLDivElement;
  readonly interactionElement?: HTMLDivElement;
}
export interface PdfOutlineEntry {readonly title: string; readonly pageNumber: number}
export interface PdfResourceSnapshot {
  readonly suspended: boolean;
  readonly cachedPageIds: readonly number[];
  readonly canvasCount: number;
  readonly resourceApiAvailable: boolean;
}
export interface PdfFindOptions {
  readonly query: string;
  readonly findPrevious: boolean;
  readonly type: "find" | "again";
  readonly caseSensitive: boolean;
  readonly entireWord: boolean;
  readonly highlightAll: boolean;
  readonly source?: object;
}
interface PdfViewReadyEvent {
  readonly pageCount: number;
  readonly pageIndex: number;
  readonly pageLabels: readonly string[];
  readonly scale: number;
  readonly viewState: PdfViewState;
}
interface PdfViewAreaEvent {readonly viewState: PdfViewState}
export interface PdfViewAdapterCallbacks {
  readonly onDocumentReady?: (pageCount: number) => void;
  readonly onPageLabelsChange?: (labels: readonly string[]) => void;
  readonly onNavigate?: (location: Required<Pick<PdfLocation, "destination">>) => void;
  readonly onReady: (event: PdfViewReadyEvent) => void;
  readonly onPageChange: (pageIndex: number) => void;
  readonly onScaleChange: (scale: number) => void;
  readonly onViewAreaChange: (event: PdfViewAreaEvent) => void;
  readonly onPageHostsChange: (hosts: readonly PdfPageHost[]) => void;
  readonly onFindMatchesChange: (current: number, total: number) => void;
  readonly onOutlineChange: (outline: readonly PdfOutlineEntry[]) => void;
  readonly onCharacterSelectionAvailabilityChange: (available: boolean) => void;
  readonly onResourceChange: (snapshot: PdfResourceSnapshot) => void;
  readonly onStatus: (status: string) => void;
}
interface PdfViewOpenInput {
  readonly bytes: Uint8Array;
  readonly container: HTMLDivElement;
  readonly viewerElement: HTMLDivElement;
  readonly initialPageIndex?: number;
  readonly preserveView?: boolean;
  readonly initialView?: PdfViewState;
  readonly initialScale?: PdfScale;
  readonly scaleLimits?: PdfScaleLimits;
  readonly active?: boolean;
  readonly callbacks: PdfViewAdapterCallbacks;
}

interface PdfSourceCharacter {
  readonly value: string;
  readonly rect: PdfRect;
  readonly rotation: number;
  readonly lineBreakAfter?: boolean;
}
interface PdfPageCharacter {
  readonly value: string;
  readonly pageIndex: number;
  readonly rect: PdfRect;
  readonly inlineRect: PdfRect;
  readonly rotation: number;
  readonly vertical: boolean;
  readonly lineIndex: number;
  readonly blockIndex: number;
  readonly lineBreakAfter: boolean;
}
interface PdfPageLine {
  readonly index: number;
  readonly characterIndexes: readonly number[];
  readonly rect: PdfRect;
}
interface PdfPageCharacterModel {
  readonly pageIndex: number;
  readonly version: number;
  readonly text: string;
  readonly chars: readonly PdfPageCharacter[];
  readonly lines: readonly PdfPageLine[];
  readonly pageElement: HTMLElement;
}
interface PdfSelectionRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
}
interface PdfCharacterSelectionSegment {
  readonly location?: PdfSelectionTextLocation;
  readonly context?: {readonly before: string; readonly after: string};
  readonly pageIndex: number;
  readonly start: number;
  readonly end: number;
  readonly text: string;
  readonly prefix: string;
  readonly suffix: string;
  readonly rects: readonly PdfRect[];
  readonly lastClientRect: PdfSelectionRect;
}
interface PdfCharacterSelection {
  readonly pageIndex: number;
  readonly start: number;
  readonly end: number;
  readonly text: string;
  readonly prefix: string;
  readonly suffix: string;
  readonly rects: readonly PdfRect[];
  readonly lastClientRect: PdfSelectionRect;
  readonly segments: readonly PdfCharacterSelectionSegment[];
  readonly focusPageIndex: number;
  readonly focusRect: PdfRect;
}

/** Public members of Core's character store, not another cache or constructor. */
export interface PdfPageCharacterStore {
  readonly _pdfPages: ReadonlyMap<number, PdfPageCharacterModel>;
  setPageCharacters(pageIndex: number, chars: readonly PdfSourceCharacter[]): void;
  hasPageCharacters(pageIndex: number): boolean;
  syncPage(pageElement: HTMLElement): PdfPageCharacterModel | undefined;
  get(pageIndex: number): PdfPageCharacterModel | undefined;
  invalidate(pageIndex: number): void;
  releasePage(pageIndex: number): void;
  clear(): void;
}

/** Structural public port for the original Core adapter. Private class fields,
 * PDF.js objects and worker configuration never cross this declaration. */
export interface PdfViewAdapter {
  readonly characterStore: PdfPageCharacterStore;
  readonly pageCount: number;
  readonly ready: boolean;
  open(input: PdfViewOpenInput): Promise<void>;
  close(): void;
  setActive(active: boolean): void;
  trimMemory(): void;
  suspend(): void;
  resume(): void;
  navigate(location: PdfLocation, resolvedPageIndex?: number): boolean;
  resolveQuoteSelection(pageIndex: number, quote: string, prefix: string, suffix: string): Promise<PdfCharacterSelection | undefined>;
  resolveLineSelection(pageIndex: number, range: SourceLineRange): Promise<PdfCharacterSelection | undefined>;
  getViewState(): PdfViewState | undefined;
  setScale(scale: PdfScale): void;
  pagePoint(x: number, y: number): PdfPagePoint | undefined;
  readingPoint(offsetTopCssPx?: number): PdfPagePoint | undefined;
  loadPageBox(pageIndex: number): Promise<readonly [number, number, number, number] | undefined>;
  normalizedPdfRect(pageIndex: number, rect: PdfRect): Promise<PdfRect | undefined>;
  focus(): void;
  clientRectForPageRect(pageIndex: number, rect: PdfRect): DOMRect | undefined;
  changeScale(difference: number, minimum?: number, maximum?: number): void;
  fitToWidth(): void;
  updateScaleAt(scaleFactor: number, origin: readonly [number, number]): void;
  find(options: PdfFindOptions): void;
  closeFind(source?: object): void;
  extractPageTexts(signal?: AbortSignal): Promise<readonly {readonly pageIndex: number; readonly text: string}[]>;
  renderThumbnail(pageNumber: number, canvas: HTMLCanvasElement, signal?: AbortSignal): Promise<void>;
  renderPageRegionPng(pageIndex: number, rect: PdfRect, signal?: AbortSignal): Promise<string>;
}

/** Runtime binding re-exports the same Core constructor; no SDK implementation. */
export declare const PdfViewAdapter: {
  new(): PdfViewAdapter;
  readonly prototype: PdfViewAdapter;
};

interface PdfViewSnapshot {
  readonly selection: PdfSelection | undefined;
  readonly selectionRevision: number;
  readonly scaleLimits: PdfScaleLimits;
  readonly ready: boolean;
  readonly loading: boolean;
  readonly source: PdfDocumentIdentity | undefined;
  readonly error: string | undefined;
  readonly status: string;
  readonly pageIndex: number;
  readonly pageCount: number;
  readonly pageLabels: readonly string[];
  readonly scalePercent: number;
  readonly viewState: PdfViewState | undefined;
  readonly pageHosts: readonly PdfPageHost[];
  readonly outline: readonly PdfOutlineEntry[];
  readonly findCurrent: number;
  readonly findTotal: number;
  readonly characterSelectionAvailable: boolean;
  readonly resources: PdfResourceSnapshot;
}
interface PdfViewOpenOptions {
  readonly source: PdfSource;
  readonly observer?: PdfViewAdapterCallbacks;
  readonly container: HTMLDivElement;
  readonly viewerElement: HTMLDivElement;
  readonly active: boolean;
  readonly initialPageIndex?: number;
  readonly initialView?: PdfViewState;
  readonly initialScale?: PdfScale;
  readonly scaleLimits?: PdfScaleLimits;
}

/** Public members only. Each original Core instance still owns its rendering
 * lifecycle; the host retains business state and persistence. */
export interface PdfViewController {
  readonly adapter: PdfViewAdapter;
  readonly getSnapshot: () => PdfViewSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
  open(options: PdfViewOpenOptions): Promise<void>;
  setSelection(selection: PdfSelection | undefined): void;
  clearSelection(): void;
  copySelection(): Promise<boolean>;
  isShowing(source: PdfDocumentIdentity): boolean;
  setActive(active: boolean): void;
  navigate(location: PdfLocation): boolean;
  setScale(scale: PdfScale): void;
  changeScale(delta: number): void;
  updateScaleAt(factor: number, origin: readonly [number, number]): void;
  find(options: PdfFindOptions): void;
  closeFind(): void;
  focus(): void;
  close(): void;
}
export declare const PdfViewController: {
  new(adapter?: PdfViewAdapter, suspendDelayMs?: number): PdfViewController;
  readonly prototype: PdfViewController;
};

export declare const PDF_BACKGROUND_SUSPEND_MS = 60_000;

export declare function PdfView(props: {
  readonly controller: PdfViewController;
  readonly containerRef: RefObject<HTMLDivElement | null>;
  readonly viewerRef: RefObject<HTMLDivElement | null>;
  readonly ready: boolean;
  readonly active: boolean;
  readonly characterSelectionAvailable: boolean;
  readonly pageHosts: readonly PdfPageHost[];
  readonly documentVersion: string;
  readonly selection?: PdfSelection | null;
  readonly onSelectionStart?: () => void;
  readonly onSelectionComplete?: (selection: PdfSelection) => void;
  readonly renderSelectionActions?: (selection: PdfSelection) => ReactNode;
  readonly onPagePointer?: (event: PdfPagePointerEvent) => void;
  readonly onPageDoubleClick?: (point: PdfPagePoint) => void;
  readonly onPageContextMenu?: (pageIndex: number, rect: PdfRect) => void;
  readonly onPointerMove?: PointerEventHandler<HTMLDivElement>;
  readonly onPointerLeave?: PointerEventHandler<HTMLDivElement>;
  readonly onScroll?: () => void;
  readonly renderPageOverlay?: (pageIndex: number) => ReactNode;
}): JSX.Element;

export declare function PdfPageControls(props: {
  pageIndex: number; pageCount: number; value: string; label?: string;
  inputRef?: RefObject<HTMLInputElement | null>; horizontal?: boolean;
  onChange: (value: string) => void; onCommit: () => void;
  onPrevious: () => void; onNext: () => void;
}): JSX.Element;

export declare function usePdfThumbnailCacheWindow(options: {
  readonly listRef: RefObject<HTMLDivElement | null>;
  readonly pageCount: number;
  readonly currentPageNumber: number;
  readonly renderingEnabled: boolean;
}): ReadonlySet<number>;
